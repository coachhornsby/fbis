import {captureCbbProviders} from '../../../../functions/lib/cbbOperatorCapture.js';
export const onRequest=({request,env})=>captureCbbProviders(request,env);
