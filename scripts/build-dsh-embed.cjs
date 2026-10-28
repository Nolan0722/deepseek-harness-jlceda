'use strict';
// Fixed rc.2 build customization: cross-site authentication and an explicit frame
// policy. No request interception, auth bypass, or popup-dependent visibility.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const cookie={from:'HttpOnly; SameSite=Strict',to:'HttpOnly; SameSite=None'};
const previousPolicy="res.setHeader('content-security-policy','frame-ancestors https://client');res.setHeader('cross-origin-embedder-policy','require-corp');res.setHeader('cross-origin-resource-policy','cross-origin');\n";
const policy="res.setHeader('content-security-policy','frame-ancestors '+((process.env.JLC_FRAME_ANCESTORS||'https://client').split(/\\s+/).filter(origin=>{try{const url=new URL(origin);return url.origin===origin&&(origin==='https://client'||/^https:\\/\\/(?:[a-z0-9-]+\\.)*(?:lceda\\.cn|easyeda\\.com)$/.test(origin));}catch{return false;}}).join(' ')||'https://client'));res.setHeader('cross-origin-embedder-policy','require-corp');res.setHeader('cross-origin-resource-policy','cross-origin');\n";
const staticAnchor='const target = resolve(normalize(join(distRoot, pathname)));';
const specs=[
  {file:'runtime/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js',expected:'0ebcca7583e082716f79b0b55bc1749d48269cc8db2989b043b321b57abd3684',...cookie},
  {file:'runtime/node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js',expected:'19bb095c5175bd5dc6532aa97512e2013a132e5073558ba4b059b8ad5b0f19a2',from:staticAnchor,to:policy+staticAnchor,previousTo:previousPolicy+staticAnchor},
];
const edits=specs.map(spec=>{
  const file=path.join(root,spec.file);let current=fs.readFileSync(file,'utf8');
  if(spec.previousTo&&current.includes(spec.previousTo)&&!current.includes(spec.to)){current=current.replace(spec.previousTo,spec.to);fs.writeFileSync(file,current);}
  if(current.split(spec.to).length===2){
    if(spec.expected&&sha(current.replace(spec.to,spec.from))!==spec.expected)throw Error('Unexpected changes in customized DSH build: '+spec.file);
    return {file:spec.file,sha256:sha(current),changed:false};
  }
  if(spec.expected&&sha(current)!==spec.expected)throw Error('Unsupported DSH build: '+spec.file);
  if(current.split(spec.from).length!==2)throw Error('Non-unique source anchor: '+spec.file);
  return {file:spec.file,source:current.replace(spec.from,spec.to),changed:true};
});
for(const edit of edits)if(edit.changed){fs.writeFileSync(path.join(root,edit.file),edit.source);edit.sha256=sha(edit.source);delete edit.source;}
const tls=path.join(root,'lab/tls');fs.mkdirSync(tls,{recursive:true});
const cert=path.join(tls,'cert.pem'),key=path.join(tls,'key.pem');
if(!fs.existsSync(cert)||!fs.existsSync(key)){
  const openssl=process.env.JLC_OPENSSL||'openssl';
  const result=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-sha256','-nodes','-keyout',key,'-out',cert,'-days','365','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{windowsHide:true,stdio:'pipe'});
  if(result.error||result.status!==0)throw Error('Cannot provision local TLS certificate: '+(result.error?.message||result.stderr));
}
const fingerprint256=new crypto.X509Certificate(fs.readFileSync(cert)).fingerprint256;
fs.writeFileSync(path.join(root,'evidence/dsh-embed-build.json'),JSON.stringify({date:new Date().toISOString(),profile:'jlceda-dom-embed',authentication:'signed HttpOnly Secure SameSite=None cookie over HTTPS/WSS; launch token required',frameAncestors:['https://client'],certificateFingerprint256:fingerprint256,edits},null,2));
console.log('Built fixed DSH DOM embedding policy; signed authentication retained.');
