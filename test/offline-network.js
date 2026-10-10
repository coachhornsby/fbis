// Standard tests must inject fixtures rather than acquire external data.
globalThis.fetch = async () => { throw new Error("Unmocked network acquisition is prohibited in offline tests"); };
