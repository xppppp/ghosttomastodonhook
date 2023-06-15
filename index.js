(function _hooks_init(port, debug) {
    const fs = require('fs').promises;
    const express = require('express');
    const bodyParser = require('body-parser');
    const axios = require('axios');
    const app = express();
    var Mastodon = require('mastodon');
    const ws = require('websocket-polyfill');
    var nostr = require('nostr-tools');
    const nhmarkdown = require('node-html-markdown');
    const bech32 = require('bech32');
    const nhm = new nhmarkdown.NodeHtmlMarkdown();
    var crypto = require('crypto');
    crypto.getRandomValues = require('get-random-values');

    const defaultConfig = {
	valid: false,
	replayTimeout: 60,
    };

    function dbg(msg) {
	if (debug) {
	    console.log(msg);
	}
    }
    function nullPromise(ret) {
	return(new Promise((npres, nprej) => { npres(ret); }));
    }

    const targets = {
	mastodon: {
	    handler: (protoConfig, post) => {
		var m = new Mastodon({
		    access_token: protoConfig._accessToken,
		    api_url: protoConfig._APIUrl
		});
		function makeMastodonStatus(gp) {
		    let s = gp.plaintext;
		    if (gp.url) {
			s = 'Original: ' + gp.url + '\n' + s;
		    }
		    if (s.length > protoConfig._maxStatusLength) {
			s = s.substring(0, protoConfig._maxStatusLength - 3) + '...';
		    }
		    return(s);
		}
		let doit = protoConfig._doit;
		if (doit && protoConfig._tags &&
		    Array.isArray(protoConfig._tags) &&
		    protoConfig._tags.length) {
		    doit = (post.tags && Array.isArray(post.tags) &&
			    post.tags.length) ?
			protoConfig._tags.some((_t) => {
			    return(post.tags.find((_e) => {
				return(_e.name == _t) }) ? true : false)}) : 
			false;
		    if (!doit) {
			dbg('post rejected: no required tag present');
		    }
		}
		if (doit) {
		    let postParameters = {
			status: makeMastodonStatus(post),
		    };
		    let tlp;
		    if (post.feature_image) {
			dbg(`getting ${post.feature_image}`);
			tlp = axios.get(post.feature_image, {
			    responseType: 'stream'
			});
		    } else {
			dbg('no image');
			tlp = nullPromise({nomedia:true});
		    }
		    tlp.then((aResp) => {
			if (aResp.nomedia) {
			    dbg('no image 2');
			    return(nullPromise({nomedia:true}));
			} else {
			    dbg('mastodon posting image');
			    return(m.post('/media', { file: aResp.data }));
			}
		    }).then((mmResp) => {
			dbg('postpublish to mastodon media: ' +
			    JSON.stringify(mmResp.data));
			if (mmResp.data && mmResp.data.id) {
			    postParameters.media_ids = [ mmResp.data.id ];
			}
			return(m.post('/statuses', postParameters));
		    }).then((msResp) => {
			if (msResp && msResp.data) {
			    dbg('postpublish mastodon status: ' +
				JSON.stringify(msResp.data));
			} else {
			    dbg('postpublish mastodon status: no response data');
			}
		    }).catch((error) => {
			dbg('postpublish mastodon status failure: ' +
			    JSON.stringify(error));
		    });
		} else {
		    console.log('Would have posted to mastodon: ' +
				JSON.stringify(post));
		}
	    }
	},
	nostr: {
	    handler: (protoConfig, post) => {
		let doit = protoConfig._doit;
		if (doit && protoConfig._tags &&
		    Array.isArray(protoConfig._tags) &&
		    protoConfig._tags.length) {
		    doit = (post.tags && Array.isArray(post.tags) &&
			    post.tags.length) ?
			protoConfig._tags.some((_t) => {
			    return(post.tags.find((_e) => {
				return(_e.name == _t) }) ? true : false)}) :
			false;
		    if (!doit) {
			dbg('post rejected: no required tag present');
		    }
		}
		if (doit) {
		    let event = {
			kind: 30023,
			pubkey: protoConfig._pk,
			created_at: Math.floor((post.created_at ? (new Date(post.created_at)) : Date.now()) / 1000),
			tags: [],
			title: post.title,
			image: post.feature_image,
			content: nhm.translate(post.html),
		    };
		    try {
			let pko = bech32.bech32.decode(protoConfig._pk);
			if (pko.prefix == 'npub') {
			    event.pubkey = bech32.bech32.fromWords(pko.words).reduce(
				(_a,_cv) => {
				    _a = _a + _cv.toString(16).padStart(2, '0'); return(_a);
				}, '');
			}
		    }
		    catch (pkerr) {
		    }
		    event.id = nostr.getEventHash(event);
		    let sk = protoConfig._sk;
		    try {
			let sko = bech32.bech32.decode(protoConfig._sk);
			if (sko.prefix == 'nsec') {
			    sk = bech32.bech32.fromWords(sko.words).reduce(
				(_a,_cv) => {
				    _a = _a + _cv.toString(16).padStart(2, '0'); return(_a);
				}, '');
			}
		    }
		    catch (skerr) {
			console.error('error making sk: ' + skerr.message);
		    }
		    event.sig = nostr.getSignature(event, sk);
		    const relay = nostr.relayInit(protoConfig._relay);
		    relay.on('connect', () => {
			dbg('got relay connected dispatch');
		    });
		    relay.on('error', () => {
			console.error(`failed to connect to ${protoConfig._relay}`);
			relay.close();
		    });
		    relay.connect().then(() => {
			dbg(`connected to ${protoConfig._relay}`);
			let pub = relay.publish(event);
			pub.on('ok', () => {
			    console.log(`${protoConfig._relay} has accepted our event`);
			    relay.close();
			});
			pub.on('failed', reason => {
			    console.log(`failed to publish to ${protoConfig._relay}: ${reason}`);
			    relay.close();
			});
		    });
		} else {
		    console.log('Would have posted to nostr: ' +
				JSON.stringify(post));
		}
	    },
	},
    };

    async function _doit() {
	var config = defaultConfig;
	var configFile = process.env.CONFIG || './config.json';
	try {
	    const readBuffer = await fs.readFile(configFile);
	    config = JSON.parse(readBuffer);
	    if (!config.replayTimeout) {
		config.replayTimeout = 180;
	    }
	    config.valid = true;
	} catch (cErr) {
	    console.error(`Cannot read configuration: ${cErr.message}`);
	    console.error(JSON.stringify(cErr));
	}
	if (config.valid) {
	    app.use(bodyParser.urlencoded({ extended: false }));
	    app.use(bodyParser.json());
	    app.get('/', (req, res) => res.send('hook responder present.'));
	    app.get('/ayt', (req, res) => res.send('Yes.'));

	    if (config.targets && Array.isArray(config.targets)) {
		config.targets.forEach((_t) => {
		    if (targets[_t.protocol]) {
			app.post(_t._route, (req, res) => {
			    if (req.body.post.current.id) {
				if (!config.urlCheck ||
				    req.body.post.current.url.startsWith(config.urlCheck)) {
				    dbg(`postpublish ${req.body.post.current.id} to ${_t.protocol}`);
				    res.status(200).send();
				    targets[_t.protocol].handler(_t, req.body.post.current);
				} else {
				    res.status(400).send({message: 'post rejected'});
				    console.error(`post ${req.body.post.current.url} rejected, does not match ${config.urlCheck}`);
				}
			    } else {
				res.status(400).send({message: 'no post identifier'});
				console.error('No post identifier in ' +
					      JSON.stringify(req.body.post.current));
			    }
			});
		    } else {
			console.error(`No target entry for ${_t.protocol}`);
		    }
		});
	    }
	    app.listen(port, () => {
		dbg(`hooks listening on port ${port}`);
	    });
	} else {
	    console.error('Invalid configuration.');
	    return(1);
	}
	return(0);
    }
    
    _doit();
})(process.env.PORT || 3001,
   process.env.DEBUG || 0);
