Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
[ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IEnum {
 int EnumAudioEndpoints(int flow,uint mask,out ICollection devices);
 int GetDefaultAudioEndpoint(int flow,int role,out IDevice device); int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id,out IDevice device);
}
[ComImport,Guid("0BD7A1BE-7A1A-44DB-8397-C0A0C6F90B9C"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ICollection {
 int GetCount(out uint count); int Item(uint index,out IDevice device);
}
[ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevice {
 int Activate(ref Guid iid,int clsctx,IntPtr activation,[MarshalAs(UnmanagedType.IUnknown)] out object obj);
 int OpenPropertyStore(int mode,out IntPtr props); int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[ComImport,Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IVolume {
 int Register(IntPtr p); int Unregister(IntPtr p); int GetChannelCount(out uint n);
 int SetMasterDb(float x,IntPtr c); int SetMasterScalar(float x,IntPtr c); int GetMasterDb(out float x); int GetMasterScalar(out float x);
 int SetChannelDb(uint n,float x,IntPtr c); int SetChannelScalar(uint n,float x,IntPtr c); int GetChannelDb(uint n,out float x); int GetChannelScalar(uint n,out float x);
 int SetMute([MarshalAs(UnmanagedType.Bool)] bool x,IntPtr c); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool x);
}
public class AudioRow { public string id; public float volume; public bool muted; }
public class AudioInspect {
 public static void Mute(string id,bool mute) {
  var e=(IEnum)new Enumerator();IDevice d;Marshal.ThrowExceptionForHR(e.GetDevice(id,out d));object obj;var iid=typeof(IVolume).GUID;
  Marshal.ThrowExceptionForHR(d.Activate(ref iid,23,IntPtr.Zero,out obj));var v=(IVolume)obj;
  try{Marshal.ThrowExceptionForHR(v.SetMute(mute,IntPtr.Zero));}finally{Marshal.ReleaseComObject(v);Marshal.ReleaseComObject(d);Marshal.ReleaseComObject(e);}
 }
 public static void Set(string id,float level) {
  var e=(IEnum)new Enumerator();IDevice d;Marshal.ThrowExceptionForHR(e.GetDevice(id,out d));object obj;var iid=typeof(IVolume).GUID;
  Marshal.ThrowExceptionForHR(d.Activate(ref iid,23,IntPtr.Zero,out obj));var v=(IVolume)obj;
  try{Marshal.ThrowExceptionForHR(v.SetMasterScalar(level,IntPtr.Zero));}finally{Marshal.ReleaseComObject(v);Marshal.ReleaseComObject(d);Marshal.ReleaseComObject(e);}
 }
 public static AudioRow[] Read(string[] ids) {
  var e=(IEnum)new Enumerator();var rows=new List<AudioRow>();
  foreach(string id in ids){IDevice d;Marshal.ThrowExceptionForHR(e.GetDevice(id,out d));object obj;var iid=typeof(IVolume).GUID;
   Marshal.ThrowExceptionForHR(d.Activate(ref iid,23,IntPtr.Zero,out obj));var v=(IVolume)obj;float level;bool mute;
   Marshal.ThrowExceptionForHR(v.GetMasterScalar(out level));Marshal.ThrowExceptionForHR(v.GetMute(out mute));
   rows.Add(new AudioRow{id=id,volume=level,muted=mute});Marshal.ReleaseComObject(v);Marshal.ReleaseComObject(d);
  } Marshal.ReleaseComObject(e);return rows.ToArray();
 }
}
'@
