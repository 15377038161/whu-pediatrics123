export interface Classroom {
  id: string;
  name: string;
  ownerName: string;
  ownerId: string;
  memberCount: number;
  rosterCount: number;
  /** 旧申请-审批流程的历史待审数（流程已停用，仅历史只读展示） */
  pendingCount: number;
  /** 名单已绑定但尚未完成首次选班（多班冲突/旧数据）的成员数 */
  conflictCount: number;
}
export interface ClassMember { userId: string; name: string; studentNo: string | null; cxid: string | null; }
/** 旧申请-审批流程的历史记录（流程已停用，只读展示） */
export interface ClassRequest extends ClassMember { id: string; classId: string; status: 'pending' | 'approved' | 'rejected'; }
export interface ClassRosterEntry { id: string; name: string; studentNo: string | null; cxid: string | null; userId: string | null; }
/** 学生当前归属与换班状态（student_class_state 投影） */
export interface StudentClassState {
  currentCohortId: string | null;
  onboardingDone: boolean;
  selfChangeCount: number;
  changesRemaining: number;
}
export interface ClassWorkspace {
  isAdmin: boolean;
  classes: Classroom[];
  members: ClassMember[];
  /** 旧申请-审批流程历史记录（只读） */
  requests: ClassRequest[];
  roster: ClassRosterEntry[];
  memberships: string[];
  state: StudentClassState;
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
