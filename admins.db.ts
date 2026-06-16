
import { User, UserRole } from './types';

export const ADMINS_DB: User[] = [
  { 
    id: 'admin-master', 
    name: 'المدير العام', 
    username: 'admin1',
    email: 'admin@app.com', 
    password: 'admin', 
    role: UserRole.ADMIN, 
    status: 'ACTIVE' 
  }
];
