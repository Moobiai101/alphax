console.log("[COLLABORATION_INSTANCE] Module loading started");
import { Collaboration } from "./controllers/controllers/collaboration/controller";
console.log("[COLLABORATION_INSTANCE] Collaboration class imported");

let instance: Collaboration | null = null;

export const collaboration = new Proxy({}, {
    get(target, prop) {
        if (typeof window === 'undefined') {
            return () => {}; // Return dummy function for SSR
        }
        if (!instance) {
             console.log("[COLLABORATION_INSTANCE] Lazy instantiating Collaboration");
             try {
                instance = new Collaboration();
             } catch (e) {
                console.error("[COLLABORATION_INSTANCE] Error instantiating Collaboration:", e);
                throw e;
             }
        }
        // @ts-ignore
        return instance[prop];
    },
    set(target, prop, value) {
        if (typeof window === 'undefined') return true;
        if (!instance) {
             console.log("[COLLABORATION_INSTANCE] Lazy instantiating Collaboration (set)");
             instance = new Collaboration();
        }
        // @ts-ignore
        instance[prop] = value;
        return true;
    }
}) as Collaboration;

console.log("[COLLABORATION_INSTANCE] collaboration proxy exported");
