package com.turboio.addon;

/** Durable closure of every input UID, distinct from a claim about physical lens rendering. */
interface CardInputClosure {
 boolean matches(String owner,String peerHash,String guardToken);
}
