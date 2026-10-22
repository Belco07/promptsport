// Preloaded only by the local E2E runner; real web-push encryption is preserved.
// No request addressed to a push provider can leave the test machine.
const https=require('node:https'),http=require('node:http');
const original=https.request;
https.request=function(options,callback){
  const host=typeof options==='object' ? options.hostname : '';
  if(host && (host==='fcm.googleapis.com'||host.endsWith('.push.services.mozilla.com')||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com'))) {
    return http.request({...options,hostname:'127.0.0.1',host:'127.0.0.1',port:5468,protocol:'http:',agent:undefined},callback);
  }
  return original.apply(this,arguments);
};
