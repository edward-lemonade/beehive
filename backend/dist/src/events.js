export class TypedEventEmitter {
    listeners = new Map();
    on(eventName, listener) {
        const listeners = this.listeners.get(eventName) ?? new Set();
        listeners.add(listener);
        this.listeners.set(eventName, listeners);
    }
    off(eventName, listener) {
        const listeners = this.listeners.get(eventName);
        if (!listeners)
            return;
        listeners.delete(listener);
    }
    emit(eventName, payload) {
        const listeners = this.listeners.get(eventName);
        if (!listeners)
            return;
        for (const listener of listeners) {
            listener(payload);
        }
    }
}
export const events = new TypedEventEmitter();
