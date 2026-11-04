import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureConverterSource,converterCommand } from './converter.mjs';
import { ggufMetadata } from './hardware.mjs';
import { inspectHuggingFaceFolder } from './hf-model-folder.mjs';

export const CONVERSION_FORMATS=['f16','bf16','q8_0','Q4_K_M','Q5_K_M','Q6_K'];
const activeStatuses=['preparing','converting','quantizing','publishing'];
export const conversionPython=dataDir => path.join(dataDir,'conversion-env',process.platform==='win32' ? 'Scripts/python.exe' : 'bin/python');

export async function modelConversionEnvironment(dataDir,{ signal,log }) {
  const python=conversionPython(dataDir);
  try { await converterCommand(python,['--version'],{ signal,log }); }
  catch (error) {
    signal.throwIfAborted();
    if (error.code!=='ENOENT') throw error;
    log('Creating an isolated conversion environment. Python 3.10 or later must be installed.');
    await converterCommand(process.platform==='win32' ? 'python' : 'python3',['-m','venv',path.join(dataDir,'conversion-env')],{ signal,log });
  }
  const source=await ensureConverterSource(dataDir,{ signal,log });
  const marker=path.join(dataDir,'conversion-env','forge-converter.json');
  try { if (JSON.parse(await fs.readFile(marker,'utf8')).source===source) return { python,source }; } catch {}
  log('Installing the official converter dependencies. This first-time download can take several minutes.');
  await converterCommand(python,['-m','pip','install','-r',path.join(source,'requirements','requirements-convert_hf_to_gguf.txt')],{ signal,log,cwd:source });
  await fs.writeFile(marker,JSON.stringify({ source }));
  return { python,source };
}

export async function inspectConversionInput(input,modelDir) {
  const {source,sourceBytes}=await inspectHuggingFaceFolder(input.source);
  const format=input.format || 'q8_0';
  if (!CONVERSION_FORMATS.includes(format)) throw new Error('Choose a supported GGUF output format.');
  if (input.name!==undefined && typeof input.name!=='string') throw new Error('Enter a text model name.');
  const name=(input.name?.trim() || path.basename(source)).replace(/\.gguf$/i,'');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Use a model name of up to 100 letters, numbers, dots, underscores or hyphens.');
  const directory=await fs.realpath(modelDir);
  if (!(await fs.stat(directory)).isDirectory()) throw new Error('Choose a model library folder first.');
  const output=path.join(directory,`${name}-${format.toUpperCase()}.gguf`);
  try { await fs.lstat(output); throw new Error('That GGUF already exists. Choose a different model name; existing files are never replaced.'); } catch (error) { if (error.code!=='ENOENT') throw error; }
  const quantized=format.startsWith('Q');
  const requiredBytes=Math.ceil(sourceBytes*(quantized ? 3 : 2)+1024**3);
  const disk=await fs.statfs(directory);
  if (disk.bavail*disk.bsize<requiredBytes) throw new Error(`Conversion needs approximately ${(requiredBytes/1024**3).toFixed(1)} GiB of free space in the model library, including temporary files. Free space or choose a smaller model.`);
  return { source,sourceBytes,format,directory,output,requiredBytes,quantized };
}

async function findQuantizer(runtime,settings) {
  let executable;
  try { executable=await runtime.executable(settings); } catch { throw new Error('Install a llama.cpp runtime in Models first, or choose F16, BF16 or Q8_0 conversion.'); }
  const quantizer=path.join(path.dirname(executable),process.platform==='win32' ? 'llama-quantize.exe' : 'llama-quantize');
  try { await fs.access(quantizer,process.platform==='win32' ? constants.F_OK : constants.X_OK); }
  catch { throw new Error('This runtime does not include llama-quantize. Install a complete official llama.cpp runtime, or choose F16, BF16 or Q8_0.'); }
  return quantizer;
}

export class ModelConverter {
  constructor(store,runtime,{ environment=modelConversionEnvironment,run=converterCommand,quantizer=findQuantizer }={}) {
    this.store=store; this.runtime=runtime; this.environment=environment; this.run=run; this.quantizer=quantizer;
    this.job=store.state.modelConversion || null; this.task=null; this.starting=false;
    if (activeStatuses.includes(this.job?.status)) { this.job.status='interrupted'; this.job.error='Forge stopped before conversion finished. Start the conversion again.'; }
  }
  get active() { return this.starting || Boolean(this.task); }
  snapshot() { return { active:this.active,job:this.job,formats:CONVERSION_FORMATS }; }
  async persist() { this.store.state.modelConversion=this.job; await this.store.save(); }
  async initialize() {
    if (this.job?.status==='interrupted' && this.job.directory && /^[a-f0-9-]{36}$/.test(this.job.id)) {
      await fs.rm(path.join(this.job.directory,`.forge-convert-${this.job.id}`),{ recursive:true,force:true });
      await this.persist();
    }
  }
  async start(input) {
    if (this.active) throw new Error('A model conversion is already running.');
    if (this.runtime.busy || !['stopped','error'].includes(this.runtime.status)) throw new Error('Unload the inference model before converting to keep memory available.');
    this.starting=true;
    try {
      const config=await inspectConversionInput(input,this.store.state.settings.modelDir);
      if (config.quantized) config.quantizer=await this.quantizer(this.runtime,this.store.state.settings);
      this.job={ id:randomUUID(),status:'preparing',created:Date.now(),source:config.source,format:config.format,directory:config.directory,output:config.output,logs:[],error:'' };
      await this.persist();
      this.controller=new AbortController();
      this.task=this.convert(config,this.controller.signal).finally(() => { this.task=null; });
      void this.task.catch(() => {});
    } finally { this.starting=false; }
    return this.snapshot();
  }
  async convert(config,signal) {
    const staging=path.join(config.directory,`.forge-convert-${this.job.id}`);
    const log=text => { this.job.logs.push(...String(text).split(/[\r\n]+/).filter(Boolean).map(line => line.slice(0,1500))); this.job.logs=this.job.logs.slice(-100); };
    try {
      await fs.mkdir(staging);
      const { python,source }=await this.environment(this.store.dataDir,{ signal,log });
      signal.throwIfAborted(); this.job.status='converting'; await this.persist();
      const intermediate=path.join(staging,'model.gguf');
      const options={ signal,log,env:{ HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1' } };
      log(`Converting local weights to ${config.quantized ? 'F16 before quantization' : config.format.toUpperCase()}…`);
      await this.run(python,[path.join(source,'convert_hf_to_gguf.py'),config.source,'--outfile',intermediate,'--outtype',config.quantized ? 'f16' : config.format],options);
      let result=intermediate;
      if (config.quantized) {
        signal.throwIfAborted(); this.job.status='quantizing'; await this.persist();
        result=path.join(staging,'quantized.gguf'); log(`Quantizing to ${config.format}…`);
        await this.run(config.quantizer,[intermediate,result,config.format,String(Math.min(2,this.store.state.settings.threads || 2))],options);
      }
      signal.throwIfAborted();
      const metadata=await ggufMetadata(result);
      if (!metadata.architecture || metadata.kind==='adapter') throw new Error('The converter did not produce a valid GGUF inference model. Check the model architecture and conversion logs.');
      this.job.status='publishing'; await this.persist();
      // Publish exclusively: neither a pre-existing model nor one added during conversion may be overwritten.
      try { await fs.link(result,config.output); }
      catch (error) { if (!['EPERM','ENOTSUP','EOPNOTSUPP','EXDEV'].includes(error.code)) throw error; await fs.copyFile(result,config.output,constants.COPYFILE_EXCL); }
      this.job.status='completed'; this.job.completed=Date.now(); this.job.bytes=(await fs.stat(config.output)).size;
      log('Conversion complete. The GGUF is available in your model library.');
    } catch (error) {
      this.job.status=signal.aborted ? 'cancelled' : 'error';
      this.job.error=signal.aborted ? 'Conversion cancelled. Source model files were kept.' : error.message;
      if (error.code==='ENOENT') this.job.error+=' Check that Python 3.10+ and the complete model files are installed.';
      if (error.code==='EEXIST') this.job.error='The output file already exists. Choose a different name; it was not replaced.';
    } finally {
      await fs.rm(staging,{ recursive:true,force:true });
      await this.persist();
    }
  }
  async cancel() {
    if (!this.task) throw new Error('No model conversion is running.');
    this.controller.abort(new Error('Conversion cancelled.'));
    await this.task; return this.snapshot();
  }
  async close() { if (this.task) { this.controller.abort(new Error('Forge is closing.')); await this.task; } }
}
