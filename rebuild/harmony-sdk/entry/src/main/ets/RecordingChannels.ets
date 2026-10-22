// Channel means an audio source, never a verified person or microphone identity.
export function recordingMono(pcm:Int16Array,channel:string='mix'):Float32Array{
  if(channel!=='mix'&&channel!=='left'&&channel!=='right')throw new Error('recording-channel-invalid');
  if(pcm.length%2!==0)throw new Error('recording-stereo-invalid');
  const out=new Float32Array(pcm.length/2);
  for(let i=0;i<out.length;i++)out[i]=(channel==='left'?pcm[2*i]:channel==='right'?pcm[2*i+1]:(pcm[2*i]+pcm[2*i+1])/2)/32768;
  return out;
}
