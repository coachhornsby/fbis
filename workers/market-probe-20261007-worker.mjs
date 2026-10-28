// Retired paid-provider probe. No network or database calls.
export default {fetch(){return new Response('Legacy probe retired',{status:410});}};
