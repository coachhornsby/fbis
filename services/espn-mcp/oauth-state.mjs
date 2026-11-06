import {DurableObject} from 'cloudflare:workers';
import {applyOAuthState} from './oauth-storage.mjs';
// One owner is the coordination atom: atomic replay prevention and refresh rotation.
export class EspnOAuthState extends DurableObject {async apply(request){return applyOAuthState(this.ctx.storage,request);}}
