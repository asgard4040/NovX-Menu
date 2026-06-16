import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { 
  initializeFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy,
  limit,
  writeBatch
} from "firebase/firestore";
import { GoogleGenAI } from "@google/genai";
import { User, SalesRequest, Institution, RequestStatus, UserRole, SystemProduct, Notification } from "../types";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true
}, firebaseConfig.firestoreDatabaseId || undefined);
export const auth = getAuth(app);

const SESSION_KEY = 'mandoubi_session';

// Error Handler definitions as per Firebase Integration skill
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
    },
    operationType,
    path
  };
  console.error('Firestore Error Details: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const api = {
  auth: {
    login: async (username: string, password: string): Promise<User | null> => {
      const normalizedUsername = username.toLowerCase().trim();
      
      try {
        // Fallback الفوري للمدير العام لضمان الدخول في أي بيئة
        if (normalizedUsername === 'admin1' && password === 'admin') {
          const defaultAdmin: User = {
            id: 'admin-master',
            name: 'المدير العام',
            username: 'admin1',
            email: 'admin@app.com',
            password: 'admin',
            role: UserRole.ADMIN,
            status: 'ACTIVE'
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(defaultAdmin));
          return defaultAdmin;
        }

        // محاولة تسجيل الدخول عبر Firestore للمستخدمين الآخرين
        const q = query(
          collection(db, "users"),
          where("username", "==", username),
          where("password", "==", password),
          limit(1)
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0];
          const user = { ...docSnap.data(), id: docSnap.id } as User;
          if (user.status === 'SUSPENDED') throw new Error("ACCOUNT_SUSPENDED");
          localStorage.setItem(SESSION_KEY, JSON.stringify(user));
          return user;
        }

        return null;
      } catch (err) { 
        console.error("Login process error:", err);
        // في حال وجود خطأ في الشبكة أو في غياب قاعدة البيانات قبل التغذية الأولى، نظل نحاول الدخول الاحتياطي للمدير
        if (normalizedUsername === 'admin1' && password === 'admin') {
           return {
            id: 'admin-master',
            name: 'المدير العام',
            username: 'admin1',
            role: UserRole.ADMIN,
            status: 'ACTIVE'
          } as User;
        }
        throw err; 
      }
    },
    logout: () => localStorage.removeItem(SESSION_KEY),
    getCurrentUser: (): User | null => {
      try {
        const session = localStorage.getItem(SESSION_KEY);
        if (!session) return null;
        return JSON.parse(session);
      } catch (e) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
    },
    updateProfile: async (id: string, updates: Partial<User>): Promise<User> => {
      try {
        await updateDoc(doc(db, "users", id), updates);
        const docSnap = await getDoc(doc(db, "users", id));
        const updatedUser = { ...docSnap.data(), id: docSnap.id } as User;
        const session = localStorage.getItem(SESSION_KEY);
        if (session) {
          try {
            const currentUser = JSON.parse(session);
            if (currentUser.id === id) localStorage.setItem(SESSION_KEY, JSON.stringify(updatedUser));
          } catch (e) {}
        }
        return updatedUser;
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${id}`);
        throw error;
      }
    },
    seedAdmin: async (): Promise<void> => {
      try {
        const q = query(collection(db, "users"), where("username", "==", "admin1"), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
          await setDoc(doc(db, "users", "admin-master"), {
            id: 'admin-master',
            name: 'المدير العام',
            username: 'admin1',
            email: 'admin@app.com',
            password: 'admin',
            role: UserRole.ADMIN,
            status: 'ACTIVE'
          });
          console.log("Default admin seeded successfully in Firestore.");
        }
      } catch (e) {
        console.error("Seeding admin failed:", e);
      }
    }
  },

  requests: {
    getAll: async (): Promise<SalesRequest[]> => {
      try {
        const q = query(collection(db, "requests"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as SalesRequest[];
      } catch (error) {
        try {
          const snapshot = await getDocs(collection(db, "requests"));
          return snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as SalesRequest[];
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, "requests");
          return [];
        }
      }
    },
    create: async (request: Omit<SalesRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<SalesRequest> => {
      try {
        const docRef = doc(collection(db, "requests"));
        const payload: SalesRequest = {
          ...request,
          id: docRef.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await setDoc(docRef, payload);
        return payload;
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, "requests");
        throw error;
      }
    },
    updateStatus: async (id: string, status: RequestStatus, note?: string): Promise<void> => {
      try {
        const docRef = doc(db, "requests", id);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) throw new Error("Request document does not exist");
        const request = docSnap.data() as SalesRequest;

        await updateDoc(docRef, {
          status,
          rejectionReason: note || "",
          updatedAt: new Date().toISOString()
        });

        // مزامنة البيانات مع جدول المؤسسات عند القبول
        if (status === RequestStatus.ACCEPTED) {
          await api.institutions.syncFromRequest({
            institutionName: request.institutionName,
            agentName: request.agentName,
            location: request.location,
            systemName: request.systemName,
            status: status
          });
        }

        const notifRef = doc(collection(db, "notifications"));
        await setDoc(notifRef, {
          id: notifRef.id,
          userId: request.agentId,
          title: status === RequestStatus.ACCEPTED ? 'تم قبول طلبك ✅' : 'عذراً، تم رفض الطلب ❌',
          message: status === RequestStatus.ACCEPTED ? `تمت الموافقة على طلبك لـ ${request.institutionName}.` : `تم رفض الطلب المقدم لـ ${request.institutionName}.`,
          type: status === RequestStatus.ACCEPTED ? 'SUCCESS' : 'DANGER',
          isRead: false,
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `requests/${id}`);
        throw error;
      }
    }
  },

  notifications: {
    getAll: async (userId: string): Promise<Notification[]> => {
      try {
        const q = query(collection(db, "notifications"), where("userId", "==", userId));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as Notification[];
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, "notifications");
        return [];
      }
    },
    markAsRead: async (id: string): Promise<void> => {
      try {
        await updateDoc(doc(db, "notifications", id), { isRead: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `notifications/${id}`);
      }
    },
    markAllAsRead: async (userId: string): Promise<void> => {
      try {
        const q = query(collection(db, "notifications"), where("userId", "==", userId), where("isRead", "==", false));
        const snapshot = await getDocs(q);
        const batch = writeBatch(db);
        snapshot.docs.forEach(d => {
          batch.update(d.ref, { isRead: true });
        });
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, "notifications");
      }
    }
  },

  agents: {
    getAll: async (): Promise<User[]> => {
      try {
        const q = query(collection(db, "users"), where("role", "==", UserRole.AGENT));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as User[];
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, "users");
        return [];
      }
    },
    getById: async (id: string): Promise<User | null> => {
      try {
        const docSnap = await getDoc(doc(db, "users", id));
        if (docSnap.exists()) {
          return { ...docSnap.data(), id: docSnap.id } as User;
        }
        return null;
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `users/${id}`);
        return null;
      }
    },
    create: async (agent: Omit<User, 'id' | 'status' | 'role'>): Promise<User> => {
      try {
        const docRef = doc(collection(db, "users"));
        const payload: User = {
          ...agent,
          id: docRef.id,
          role: UserRole.AGENT,
          status: 'ACTIVE'
        };
        await setDoc(docRef, payload);
        return payload;
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, "users");
        throw error;
      }
    },
    update: async (id: string, updates: Partial<User>): Promise<void> => {
      try {
        await updateDoc(doc(db, "users", id), updates);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${id}`);
        throw error;
      }
    },
    toggleStatus: async (id: string): Promise<void> => {
      try {
        const docRef = doc(db, "users", id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const currentStatus = docSnap.data().status;
          const newStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
          await updateDoc(docRef, { status: newStatus });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${id}`);
        throw error;
      }
    }
  },

  admins: {
    getAll: async (): Promise<User[]> => {
      try {
        const qAdmin = query(collection(db, "users"), where("role", "==", UserRole.ADMIN));
        const qSup = query(collection(db, "users"), where("role", "==", UserRole.SUPERVISOR));
        const [snapAdmin, snapSup] = await Promise.all([getDocs(qAdmin), getDocs(qSup)]);
        
        const list: User[] = [];
        snapAdmin.docs.forEach(d => { list.push({ ...d.data(), id: d.id } as User); });
        snapSup.docs.forEach(d => { list.push({ ...d.data(), id: d.id } as User); });
        return list;
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, "users");
        return [];
      }
    },
    create: async (admin: Omit<User, 'id' | 'status' | 'role'>): Promise<User> => {
      try {
        const docRef = doc(collection(db, "users"));
        const payload: User = {
          ...admin,
          id: docRef.id,
          role: UserRole.SUPERVISOR,
          status: 'ACTIVE'
        };
        await setDoc(docRef, payload);
        return payload;
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, "users");
        throw error;
      }
    },
    update: async (id: string, updates: Partial<User>): Promise<void> => {
      try {
        await updateDoc(doc(db, "users", id), updates);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${id}`);
        throw error;
      }
    }
  },

  institutions: {
    getAll: async (): Promise<Institution[]> => {
      try {
        const q = query(collection(db, "institutions"), orderBy("lastVisitDate", "desc"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as Institution[];
      } catch (error) {
        try {
          const snapshot = await getDocs(collection(db, "institutions"));
          return snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as Institution[];
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, "institutions");
          return [];
        }
      }
    },
    create: async (data: Omit<Institution, 'id' | 'status' | 'lastVisitDate'>): Promise<Institution> => {
      try {
        const docRef = doc(collection(db, "institutions"));
        const payload: Institution = {
          ...data,
          id: docRef.id,
          lastVisitDate: new Date().toISOString().split('T')[0],
          status: 'INTERESTED'
        };
        await setDoc(docRef, payload);
        return payload;
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, "institutions");
        throw error;
      }
    },
    delete: async (id: string): Promise<void> => {
      try {
        await deleteDoc(doc(db, "institutions", id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `institutions/${id}`);
        throw error;
      }
    },
    syncFromRequest: async (request: any): Promise<void> => {
      try {
        const docRef = doc(collection(db, "institutions"));
        const payload: Institution = {
          id: docRef.id,
          name: request.institutionName.trim(),
          city: request.location?.split('-')[0]?.trim() || 'غير محدد',
          address: request.location || '',
          offeredSystem: request.systemName,
          lastVisitedBy: request.agentName,
          lastVisitDate: new Date().toISOString().split('T')[0],
          status: request.status === RequestStatus.ACCEPTED ? 'CUSTOMER' : 'INTERESTED'
        };
        await setDoc(docRef, payload);
      } catch (error) {
        console.error("Institution sync failed:", error);
      }
    }
  },

  systems: {
    getAll: async (): Promise<SystemProduct[]> => {
      try {
        const snapshot = await getDocs(collection(db, "systems"));
        return snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as SystemProduct[];
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, "systems");
        return [];
      }
    },
    create: async (system: Omit<SystemProduct, 'id'>): Promise<SystemProduct> => {
      try {
        const docRef = doc(collection(db, "systems"));
        const payload: SystemProduct = {
          ...system,
          id: docRef.id,
          tiers: Array.isArray(system.tiers) ? system.tiers : []
        };
        await setDoc(docRef, payload);
        return payload;
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, "systems");
        throw error;
      }
    },
    update: async (id: string, system: Partial<SystemProduct>): Promise<void> => {
      try {
        await updateDoc(doc(db, "systems", id), system);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `systems/${id}`);
        throw error;
      }
    },
    delete: async (id: string): Promise<void> => {
      try {
        await deleteDoc(doc(db, "systems", id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `systems/${id}`);
        throw error;
      }
    }
  },

  settings: {
    get: async (): Promise<{ logoUrl?: string; supportPhone?: string }> => {
      try {
        const docSnap = await getDoc(doc(db, "settings", "global"));
        if (docSnap.exists()) {
          return docSnap.data() as { logoUrl?: string; supportPhone?: string };
        }
        return { logoUrl: '', supportPhone: '' };
      } catch (error) {
        console.error("Failed to fetch settings, returning fallback:", error);
        return { logoUrl: '', supportPhone: '' };
      }
    },
    update: async (data: { logoUrl?: string; supportPhone?: string }): Promise<void> => {
      try {
        await setDoc(doc(db, "settings", "global"), data, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, "settings/global");
        throw error;
      }
    }
  },

  data: {
    exportAll: () => alert("البيانات مخزنة سحابياً الآن في Firestore."),
    importAll: async (file: File) => alert("البيانات مخزنة سحابياً.")
  },

  ai: {
    analyzePerformance: async (requests: SalesRequest[]): Promise<string> => {
      try {
        const apiKey = (typeof process !== "undefined" && process.env ? process.env.GEMINI_API_KEY || process.env.API_KEY : "") || ((import.meta as any).env ? (import.meta as any).env.VITE_GEMINI_API_KEY : "") || "";
        const ai = new GoogleGenAI({ apiKey });
        const summary = requests.map(r => `${r.agentName}: ${r.status}`).join(', ');
        const response = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: `حلل بيانات المبيعات التالية واقترح خطة عمل: ${summary}`,
          config: { systemInstruction: "أنت خبير مبيعات تحلل أداء الفريق الميداني." }
        });
        return response.text || "تعذر التحليل.";
      } catch (e) {
        console.error("Performance analysis failed:", e);
        return "حدث خطأ أثناء إجراء التحليل الذكي.";
      }
    },
    resetSystemData: async (): Promise<void> => {
      try {
        // تنظيف الجداول التشغيلية فقط مع الإبقاء على المستخدمين والأنظمة
        const batch = writeBatch(db);
        
        const reqSnap = await getDocs(collection(db, "requests"));
        reqSnap.docs.forEach(d => batch.delete(d.ref));
        
        const instSnap = await getDocs(collection(db, "institutions"));
        instSnap.docs.forEach(d => batch.delete(d.ref));
        
        const notifSnap = await getDocs(collection(db, "notifications"));
        notifSnap.docs.forEach(d => batch.delete(d.ref));
        
        await batch.commit();
        console.log("Operational system data reset successfully in Firestore.");
      } catch (error) {
        console.error("System data wipe failed:", error);
      }
    }
  }
};
