'use strict';
// CDP commands that affect pixels/viewport belong to the editor's top-level
// target. Frame Runtime.evaluate continues to use the actual OOPIF target.
const saved=new WeakMap();
async function evaluate(editor,expression){const r=await editor.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function setFrameViewport(editor,width,height){
  if(!saved.has(editor))saved.set(editor,await evaluate(editor,'({css:document.querySelector("#jlc-dsh-frame").style.cssText,width:window.__JLC_DSH_DEBUG__.state().layout.right.right})'));
  await editor.call('Emulation.setDeviceMetricsOverride',{width:width+1000,height:height+500,deviceScaleFactor:1,mobile:false});
  await evaluate(editor,`(async()=>{await window.__JLC_DSH_DEBUG__.resize(${width+40});const f=document.querySelector('#jlc-dsh-frame');f.style.width='${width}px';f.style.height='${height}px';f.style.flex='none';})()`);
}
async function clearFrameViewport(editor){
  const original=saved.get(editor);if(!original)return;
  await editor.call('Emulation.clearDeviceMetricsOverride');
  await evaluate(editor,`(async()=>{document.querySelector('#jlc-dsh-frame').style.cssText=${JSON.stringify(original.css)};await window.__JLC_DSH_DEBUG__.resize(${original.width});})()`);
  saved.delete(editor);
}
async function captureFrame(editor){
  await evaluate(editor,'window.electronAPI.focusWindow()');
  const rect=await evaluate(editor,'document.querySelector("#jlc-dsh-frame").getBoundingClientRect().toJSON()');
  if(rect.width<=0||rect.height<=0)throw Error('Cannot capture a hidden DSH frame');
  return editor.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scale:1}});
}
module.exports={setFrameViewport,clearFrameViewport,captureFrame};
