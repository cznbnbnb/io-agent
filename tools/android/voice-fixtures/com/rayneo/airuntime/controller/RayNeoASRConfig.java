package com.rayneo.airuntime.controller;
public final class RayNeoASRConfig {
 public String format="pcm";public int rate=16000;
 public RayNeoServerConfig server;public String user,device,model,language,biz;public boolean debug;
 public void setServerConfig(RayNeoServerConfig value){server=value;}
 public void setUserName(String value){user=value;}public void setDeviceName(String value){device=value;}public void setDeviceModel(String value){model=value;}
 public void setLanguageCode(String value){language=value;}public void setInputAudioFormat(String value){format=value;}public void setInputAudioRate(int value){rate=value;}
 public void setBizType(String value){biz=value;}public void setEnvDebug(boolean value){debug=value;}
 public String getInputAudioFormat(){return format;}public int getInputAudioRate(){return rate;}
}
