const explanations={
 modelDir:'The folder where Forge looks for your local GGUF models. Existing files stay in place.',runtimePath:'The llama.cpp server program that runs your models. Leave empty to use the runtime installed by Forge.',
 executionMode:'Automatic chooses a compatible CPU or GPU configuration. Manual modes give you control over where model layers run.',gpuLayers:'How many model layers to put on the GPU in hybrid mode. More layers generally use more GPU memory.',autoGpuLayers:'Let Forge estimate how many layers fit while keeping the configured system memory reserve.',threads:'The number of CPU threads available to the model. More is not always faster.',
 contextSize:'How much conversation and document content the model can consider at once. Larger values use more memory.',maxTokens:'The maximum length of one reply in model tokens. A token is roughly part of a word.',temperature:'Controls randomness. Lower values are more predictable; higher values encourage variation.',topP:'Limits the next-word choices to a cumulative probability. Lower values usually produce more focused responses.',topK:'Limits how many possible next tokens the model considers. Zero leaves this limit disabled.',minP:'Filters unlikely next-token choices relative to the most likely one.',repeatPenalty:'Discourages repeated words and phrases. Very high values can make responses unnatural.',seed:'A starting value for randomness. Use -1 for a new random seed each time.',
 batchSize:'How many prompt tokens the runtime can process in one batch. Larger batches can use more memory.',microBatchSize:'The smaller internal batch used while processing the prompt. It cannot exceed the batch size.',reserveRamGiB:'System memory Forge tries to leave available for other applications when loading a model.',kvOnGpu:'Keep the model’s conversation cache on the GPU. This may be faster but uses more video memory.',performanceMode:'Responsive limits background resource use. Balanced allows the configured CPU threads.',loadStrategy:'Controls how model weights are read from disk. Automatic chooses a lower-pressure loading path.',
 systemPrompt:'Default instructions for project conversations. Individual conversations can override these.',chatSystemPrompt:'Default instructions for normal chat. Each conversation can use its own instructions.',thinking:'Controls model reasoning when the selected model and its template support it.',maxAgentSteps:'Maximum number of model turns the project assistant can use while working on one request.',allowReadTools:'Allow the project assistant to inspect files in the selected workspace.',allowWriteTools:'Allow the project assistant to propose changes. Every proposed write still requires your review.',showReasoning:'Show reasoning text when a model provides it.',
 projectorPath:'The matching vision component for a supported image-capable model. It must come from the same model family.',imageTokens:'The maximum model context reserved for each image. Higher values use more memory.',chatTemplate:'Override how a conversation is formatted for the model. Most models already include a suitable template.',
 theme:'Choose one of the two visual styles. Switching also applies its default reading size.',fontSize:'The text size used for conversation and document reading.',runInBackground:'Keep Forge and the loaded model available in the tray or menu bar after closing the window.',restoreSession:'Reopen the conversation you last selected when Forge starts.',enterToSend:'Send with Enter. Shift+Enter still adds a new line.',renameAfterFork:'Use the first new message as the title of a copied conversation.',
 voiceRuntimePath:'The local whisper.cpp program used to transcribe speech on this computer.',voiceModelPath:'A local Whisper model file used by the speech recognition program.',voiceLanguage:'The language code used for local transcription, such as en.',apiHost:'Choose whether the model API is available only on this computer or on your local network.',apiPort:'The network port for Forge’s optional local model API.',
 'convert-source':'Choose the complete downloaded Hugging Face folder, including the model configuration, tokenizer, and weights.',
 'convert-name':'The converted model’s name in your library. Leave blank to use the folder name.',
 'convert-format':'Smaller quantized formats need less disk space and memory, with a possible quality trade-off. Q4/Q5/Q6 require the installed quantizer.',
 'train-base':'A complete local Hugging Face model folder. Training produces a small adapter and does not modify the base weights.',
 'train-dataset':'A local conversation, document, or structured dataset. Preview and confirm it before training.',
 'train-device':'Choose where training runs. GPU options require a compatible local PyTorch installation.',
 'train-epochs':'How many passes to make over the examples, subject to the maximum step limit.',
 'train-learningRate':'How strongly each training step changes the adapter. A high value can make training unstable.',
 'train-batchSize':'Number of examples processed together. A larger batch needs more memory.',
 'train-gradientAccumulation':'Combines several small batches before updating the adapter, reducing the memory needed for a larger effective batch.',
 'train-maxLength':'Maximum tokens in a training example. Longer examples use more memory.',
 'train-loraRank':'The size of the trainable adapter. Higher ranks can learn more detail but need more resources.',
 'train-saveEvery':'How often to save a checkpoint that can be resumed.',
 'train-maxSteps':'The maximum number of training updates before the job stops.',
 'train-gradient-checkpoint':'Reduces training memory use by recomputing parts of the model. Training can take longer and the model must support it.',
 'device-base':'The OpenAI-compatible endpoint for another model server. Ollama on this computer usually uses http://localhost:11434/v1.',
 'device-key':'Optional key for the configured model server. Local Ollama generally does not require one.',
 'mcp-transport':'Choose a local command or an HTTP server. Connected MCP tools can access their own external resources and require approval before each call.',
 'mcp-command':'The executable for a local MCP server. Connecting starts the program with its own permissions.',
 'mcp-args':'Arguments passed to the local MCP command, as a JSON array.',
 'mcp-url':'The address of an MCP server using Streamable HTTP.',
 'mcp-key':'Optional bearer token used to connect to this MCP server.',
 'dataset-speaker':'Choose the person whose replies the adapter should learn. Other people’s messages provide context.',
 'session-memory':'Notes saved with this conversation and included with its future requests.',
 'prompt':'Write a message to the selected model. Your drafts are saved locally.',
 'vision-model':'Choose an image-capable model and the matching projector supplied for it.',
 'vision-projector':'A matching multimodal projector lets the selected model understand images.',
 'preset-model':'Model-specific defaults apply the next time this model is loaded.'
};

export function initHelp() {
  const tip=document.createElement('div'); tip.className='help-tooltip'; tip.id='forge-help-tooltip'; tip.setAttribute('role','tooltip'); tip.hidden=true; document.body.append(tip);
  let current;
  const hide=()=>{tip.hidden=true;current=null;};
  const show=(button,text)=>{ current=button; tip.textContent=text; tip.hidden=false; const r=button.getBoundingClientRect(); const width=Math.min(300,innerWidth-32); tip.style.width=`${width}px`; tip.style.left=`${Math.max(12,Math.min(innerWidth-width-12,r.left))}px`; tip.style.top=`${Math.max(8,Math.min(innerHeight-tip.offsetHeight-8,r.bottom+8))}px`; };
  const add=control=>{
    const label=control.closest('label'); if(!label || label.querySelector('.help-wrap')) return;
    const key=control.dataset.setting || control.id; const text=explanations[key] || label.querySelector('small')?.textContent?.trim();
    if(!text) return;
    const wrap=document.createElement('span'); wrap.className='help-wrap';
    const button=document.createElement('button'); button.type='button'; button.className='help-button'; button.textContent='i'; button.setAttribute('aria-label',`Help: ${label.firstChild?.textContent?.trim() || key}`); button.setAttribute('aria-describedby',tip.id);
    button.addEventListener('mouseenter',()=>show(button,text)); button.addEventListener('mouseleave',hide);
    button.addEventListener('focus',()=>show(button,text)); button.addEventListener('blur',hide);
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();show(button,text);});
    wrap.append(button); const caption=label.classList.contains('toggle-row') ? label.querySelector(':scope > span') : null; if(caption)caption.insertBefore(wrap,caption.firstElementChild);else label.insertBefore(wrap,label.firstElementChild);
  };
  const selector='label [data-setting],label input[id],label select[id],label textarea[id]';
  const scan=root=>{if(root.matches?.(selector))add(root);root.querySelectorAll?.(selector).forEach(add);};
  scan(document); new MutationObserver(records=>{for(const record of records)for(const added of record.addedNodes)if(added.nodeType===Node.ELEMENT_NODE)scan(added);}).observe(document.body,{childList:true,subtree:true});
  addEventListener('scroll',hide,true); addEventListener('resize',hide); document.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
}
