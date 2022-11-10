(function _hooks_init(port, debug) {
    const express = require('express');
    const bodyParser = require('body-parser');
    const axios = require('axios');
    var Mastodon = require('mastodon');

    const appConfig = {
	mastodonRoute: '/mastodon/postPublish',
	mastodonAccessToken: 'Gt07ox7817B9rsKX4icC_6s7bV-LktUsGc-B3c-k9CA',
	mastodonAPIUrl: 'https://mas.to/api/v1/',
    };

    function dbg(msg) {
	if (debug) {
	    console.log(msg);
	}
    }

    const app = express();
    var m = new Mastodon({
	access_token: appConfig.mastodonAccessToken,
	api_url: appConfig.mastodonAPIUrl
    });
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(bodyParser.json());
    app.get('/', (req, res) => res.send('hook responder present.'));
    app.get('/ayt', (req, res) => res.send('Yes.'));
    app.post(appConfig.mastodonRoute, (req, res) => {
	if (!req.body.post || !req.body.post.current) {
	    dbg('malformed ghost publish body: ' + JSON.stringify(req.body));
	    res.send(500);
	    return;
	}
	
	dbg('postpublish to mastodon: ' +
	    JSON.stringify(req.body.post.current));
	let postParameters = {
	    status: req.body.post.current.html,
	};
	if (req.body.post.current.feature_image) {
	    axios.get(req.body.post.current.feature_image, {
		responseType: 'stream'
	    }).then((aResp) => {
		m.post('/media', { file: aResp.data }).then((mmResp) => {
		    dbg('postpublish to mastodon media: ' +
			JSON.stringify(mmResp.data));
		    if (mmResp && mmResp.data && !mmResp.data.error) {
			if (mmResp.data.id) {
			    postParameters.media_ids = [ mmResp.data.id ];
			}
			m.post('/statuses', postParameters).then((msResp) => {
			    if (msResp && msResp.data) {
				dbg('postpublish mastodon status w/media: ' +
				    JSON.stringify(msResp.data));
				res.send(msResp.data);
			    } else {
				res.send(400);
			    }
			});
		    } else {
			res.send((mmResp && mmResp.data) ?
				 mmResp.data.error : 401);
		    }
		});
	    });
	} else {
	    m.post('/statuses', postParameters).then((mResp) => {
		if (mResp && mResp.data) {
		    dbg('postpublish mastodon status only success: ' +
			JSON.stringify(mResp.data));
		    res.send(mResp.data);
		} else {
		    res.send(400);
		}
	    });
	}
    });
    app.listen(port, () => {
	dbg('hooks listening on port ' + port);
    });
})(process.env.PORT || 3001,
   process.env.DEBUG || 0);
