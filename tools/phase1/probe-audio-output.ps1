# Read default render roles, mute, volume and digital peaks. No endpoint, mute or volume is changed. Optional local WAV playback is bounded by Seconds.
param([string]$WavePath='', [ValidateRange(1,45)][int]$Seconds=22)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class ProbeEnumerator {}
[ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ProbeEnum {
 [PreserveSig] int EnumAudioEndpoints(int f,uint s,out IntPtr c);
 [PreserveSig] int GetDefaultAudioEndpoint(int f,int r,out ProbeDevice d);
 [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id,out ProbeDevice d);
}
[ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ProbeDevice {
 [PreserveSig] int Activate(ref Guid iid,int clsctx,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)] out object o);
 [PreserveSig] int OpenPropertyStore(int mode,out IntPtr p);
 [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[ComImport,Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ProbeVolume {
 [PreserveSig] int Register(IntPtr p); [PreserveSig] int Unregister(IntPtr p); [PreserveSig] int GetChannelCount(out uint n);
 [PreserveSig] int SetDb(float n,IntPtr p); [PreserveSig] int SetScalar(float n,IntPtr p); [PreserveSig] int GetDb(out float n); [PreserveSig] int GetScalar(out float n);
 [PreserveSig] int SetChannelDb(uint n,float v,IntPtr p); [PreserveSig] int SetChannelScalar(uint n,float v,IntPtr p); [PreserveSig] int GetChannelDb(uint n,out float v); [PreserveSig] int GetChannelScalar(uint n,out float v);
 [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool v,IntPtr p); [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool v);
}
[ComImport,Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ProbeMeter {
 [PreserveSig] int GetPeakValue(out float n);
}
public class ProbeRow { public int role; public string id; public float volume; public bool muted; public float peak; }
public class OutputProbe {
 public static ProbeRow[] Read() {
  var e=(ProbeEnum)new ProbeEnumerator();var rows=new List<ProbeRow>();
  try { for(int role=0;role<3;role++) {
   ProbeDevice d=null;object volume=null,meter=null;
   try {Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0,role,out d));string id;Marshal.ThrowExceptionForHR(d.GetId(out id));
    Guid vi=typeof(ProbeVolume).GUID,mi=typeof(ProbeMeter).GUID;
    Marshal.ThrowExceptionForHR(d.Activate(ref vi,23,IntPtr.Zero,out volume));Marshal.ThrowExceptionForHR(d.Activate(ref mi,23,IntPtr.Zero,out meter));
    float level,peak;bool mute;Marshal.ThrowExceptionForHR(((ProbeVolume)volume).GetScalar(out level));Marshal.ThrowExceptionForHR(((ProbeVolume)volume).GetMute(out mute));Marshal.ThrowExceptionForHR(((ProbeMeter)meter).GetPeakValue(out peak));
    rows.Add(new ProbeRow {role=role,id=id,volume=level,muted=mute,peak=peak});
   } finally {if(meter!=null)Marshal.ReleaseComObject(meter);if(volume!=null)Marshal.ReleaseComObject(volume);if(d!=null)Marshal.ReleaseComObject(d);}
  }} finally {Marshal.ReleaseComObject(e);}return rows.ToArray();
 }
}
'@
$taskVoice=New-Object -ComObject SAPI.SpVoice
$taskTokens=$taskVoice.GetAudioOutputs();$taskNames=@{}
for($taskI=0;$taskI -lt $taskTokens.Count;$taskI++){$taskToken=$taskTokens.Item($taskI);$taskNames[$taskToken.Id.Split('\')[-1]]=$taskToken.GetDescription()}
$taskRows=@([OutputProbe]::Read());$taskMax=@{};foreach($taskRow in $taskRows){$taskMax[$taskRow.role]=[double]$taskRow.peak}
if($WavePath){
 $taskWave=[IO.Path]::GetFullPath($WavePath)
 if(!(Test-Path -LiteralPath $taskWave)){throw 'PROBE_WAVE_MISSING'}
 $taskPlayer=[System.Media.SoundPlayer]::new($taskWave);$taskPlayer.Load();$taskPlayer.Play()
 $taskClock=[Diagnostics.Stopwatch]::StartNew()
 try{while($taskClock.Elapsed.TotalSeconds -lt $Seconds){foreach($taskRow in [OutputProbe]::Read()){$taskMax[$taskRow.role]=[Math]::Max($taskMax[$taskRow.role],[double]$taskRow.peak)};Start-Sleep -Milliseconds 100}}
 finally{$taskPlayer.Stop();$taskPlayer.Dispose()}
}
$taskReport=@($taskRows|ForEach-Object {[pscustomobject]@{role=@('console','multimedia','communications')[$_.role];output=$taskNames[$_.id];volume_percent=[Math]::Round($_.volume*100);muted=$_.muted;max_render_peak=$taskMax[$_.role]}})
$taskReport|ConvertTo-Json -Depth 4
[Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskVoice)|Out-Null
