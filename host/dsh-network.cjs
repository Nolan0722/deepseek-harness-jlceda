'use strict';
const https=require('node:https');
const {Readable}=require('node:stream');
// Dedicated transport for the one DSH origin. It avoids both the JLC cookie
// rewriter and nested Chromium fetches in a custom HTTP protocol handler.
function createDshNetwork({certificate,session,getOrigin}){
  function open(url,{method='GET',headers={},body,signal}={}){
    return new Promise((resolve,reject)=>{
      const request=https.request(url,{method,headers,ca:certificate},response=>{
        signal?.removeEventListener('abort',abort);
        // A fetch response must remain tied to its originating frame request.
        const abortBody=()=>response.destroy(Error('DSH request aborted'));
        signal?.addEventListener('abort',abortBody,{once:true});
        response.once('close',()=>signal?.removeEventListener('abort',abortBody));
        resolve(response);
      });
      const abort=()=>request.destroy(Error('DSH request aborted'));
      if(signal?.aborted){abort();reject(Error('DSH request aborted'));return;}
      signal?.addEventListener('abort',abort,{once:true});
      request.once('error',error=>{signal?.removeEventListener('abort',abort);reject(error);});
      if(body)Readable.fromWeb(body).on('error',error=>request.destroy(error)).pipe(request);else request.end();
    });
  }
  return {
    async authenticate(url){
      const response=await open(url);response.resume();
      if(response.statusCode!==303)throw Error('DSH launch authentication failed');
      const cookies=response.headers['set-cookie'];if(!cookies?.length)throw Error('DSH did not issue a browser credential');
      for(const line of cookies){
        const parts=line.split(';').map(s=>s.trim()),at=parts[0].indexOf('='),name=parts[0].slice(0,at),value=parts[0].slice(at+1);
        if(at<1||!parts.includes('HttpOnly')||!parts.includes('Secure')||!parts.includes('SameSite=None'))throw Error('Unexpected DSH browser cookie policy');
        const maxAge=parts.find(p=>p.startsWith('Max-Age='));if(!maxAge)throw Error('Missing DSH credential lifetime');
        await session.cookies.set({url:new URL(url).origin,name,value,path:'/',httpOnly:true,secure:true,sameSite:'no_restriction',expirationDate:Date.now()/1000+Number(maxAge.slice(8))});
      }
      return new URL('/',url).href;
    },
    async fetch(request){
      if(new URL(request.url).origin!==getOrigin())throw Error('DSH network origin mismatch');
      const headers=Object.fromEntries(request.headers),cookies=await session.cookies.get({url:request.url});
      headers['accept-encoding']='identity';
      // Protocol handlers do not receive Chromium's HttpOnly Cookie header on
      // every code path. This jar is the same one used by the native WSS stack.
      headers.cookie=cookies.map(c=>`${c.name}=${c.value}`).join('; ');
      const response=await open(request.url,{method:request.method,headers,body:request.body,signal:request.signal});
      const resultHeaders=new Headers();
      for(let i=0;i<response.rawHeaders.length;i+=2)if(!['connection','keep-alive','transfer-encoding'].includes(response.rawHeaders[i].toLowerCase()))resultHeaders.append(response.rawHeaders[i],response.rawHeaders[i+1]);
      return new Response(['HEAD'].includes(request.method)||[204,205,304].includes(response.statusCode)?null:Readable.toWeb(response),{status:response.statusCode,headers:resultHeaders});
    },
  };
}
module.exports={createDshNetwork};
