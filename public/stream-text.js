const rendered=new WeakMap();
// Keep a single text node while streaming; formatting is applied once on completion.
export function updateStreamText(element,text){
  const prior=rendered.get(element);
  if(prior && prior.node.parentNode===element && element.childNodes.length===1){
    if(text.startsWith(prior.text))prior.node.appendData(text.slice(prior.text.length));
    else prior.node.data=text;
    prior.text=text;return;
  }
  const node=document.createTextNode(text);element.replaceChildren(node);rendered.set(element,{node,text});
}
