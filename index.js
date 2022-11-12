(function _hooks_init(port, debug) {
    const express = require('express');
    const bodyParser = require('body-parser');
    const axios = require('axios');
    var Mastodon = require('mastodon');

    const appConfig = {
	mastodonRoute: '/mastodon/postPublish',
	mastodonAccessToken: 'Gt07ox7817B9rsKX4icC_6s7bV-LktUsGc-B3c-k9CA',
	mastodonAPIUrl: 'https://mas.to/api/v1/',
	ghostReplayTimeout: 60,
    };

    function dbg(msg) {
	if (debug) {
	    console.log(msg);
	}
    }
    function nullPromise(ret) {
	return(new Promise((npres, nprej) => { npres(ret); }));
    }

    const app = express();
    var m = new Mastodon({
	access_token: appConfig.mastodonAccessToken,
	api_url: appConfig.mastodonAPIUrl
    });
    var inProgress = {};
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(bodyParser.json());
    app.get('/', (req, res) => res.send('hook responder present.'));
    app.get('/ayt', (req, res) => res.send('Yes.'));
    app.post(appConfig.mastodonRoute, (req, res) => {
	dbg('postpublish to mastodon: ' +
	    JSON.stringify(req.body.post.current));
	if (req.body.post.current.id) {
	    let ghostID = req.body.post.current.id;
	    if (inProgress[ghostID]) {
		if (inProgress[ghostID].done) {
		    dbg('postpublish already complete for ' + ghostID);
		    res.status(inProgress[ghostID].status).
			send(inProgress[ghostID].data);
		} else {
		    dbg('postpublish in progress ' + ghostID);
		    res.end();
		}
	    } else {
		let postParameters = {
		    status: req.body.post.current.plaintext,
		};
		inProgress[ghostID] = {
		    done: false,
		    status: 500,
		};
		let tlp;
		if (req.body.post.current.feature_image) {
		    dbg('getting ' + req.body.post.current.feature_image);
		    tlp = axios.get(req.body.post.current.feature_image, {
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
		    inProgress[ghostID].done = true;
		    if (msResp && msResp.data) {
			dbg('postpublish mastodon status: ' +
			    JSON.stringify(msResp.data));
			inProgress[ghostID].status = 200;
			inProgress[ghostID].data = msResp.data;
		    } else {
			dbg('postpublish mastodon status: no response data');
			inProgress[ghostID].status = 400;
			inProgress[ghostID].data =
			    { error: 'mastodon publish missing status' };
		    }
		}).catch((error) => {
		    dbg('postpublish mastodon status failure: ' +
			JSON.stringify(error));
		    inProgress[ghostID].done = true;
		    inProgress[ghostID].status = 500;
		    inProgress[ghostID].data = error;
		}).finally(() => {
		    res.status(inProgress[ghostID].status).send(inProgress[ghostID].data);
		    setTimeout(() => {
			dbg('cleaning up replay entry for: ' + ghostID);
			delete(inProgress[ghostID]);
		    }, appConfig.ghostReplayTimeout * 1000);
		});
	    }
	} else {
	    res.status(500).send({error: 'no ghost post id'});
	}
    });
    app.listen(port, () => {
	dbg('hooks listening on port ' + port);
    });
})(process.env.PORT || 3001,
   process.env.DEBUG || 0);
