export interface Classroom {
  id: string;
  name: string;
  ownerName: string;
  ownerId: string;
  memberCount: number;
  rosterCount: number;
  pendingCount: number;
}
export interface ClassMember { userId: string; name: string; studentNo: string | null; cxid: string | null; }
export interface ClassRequest extends ClassMember { id: string; classId: string; status: 'pending' | 'approved' | 'rejected'; }
export interface ClassRosterEntry { id: string; name: string; studentNo: string | null; cxid: string | null; userId: string | null; }
export interface ClassWorkspace {
  isAdmin: boolean;
  classes: Classroom[];
  members: ClassMember[];
  requests: ClassRequest[];
  roster: ClassRosterEntry[];
  memberships: string[];
}
export interface TeacherAccount {
  userId: string;
  name: string;
  cxid: string | null;
  email: string;
  isTeacher: boolean;
  isAdmin: boolean;
}
export interface TeacherAccessWorkspace { teachers: TeacherAccount[]; candidates: TeacherAccount[]; }
