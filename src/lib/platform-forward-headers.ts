import { extractForwardHeaders } from 'coder-coding-dev-sdk';

/** Preserve platform context, but never replace SDK service authentication with a verified app JWT. */
export function platformForwardHeaders(headers:Headers, userAccessToken?:string|null):Record<string,string> {
 const forwarded=extractForwardHeaders(Object.fromEntries(headers.entries()));
 const bearer=forwarded.authorization?.replace(/^Bearer\s+/i,'');
 if(userAccessToken&&bearer===userAccessToken)delete forwarded.authorization;
 return forwarded;
}
