import { LearningResourceManager } from '@/components/learning-resource-manager';

/**
 * 教师学习资源中心管理页（D10 / 方案第 13 节）：
 * - 资源工作流：登记元数据（含对象存储文件绑定）→ 授权班级 → 发布 → 下架/重新编辑；
 * - 八个操作视频（对象存储 CONSOLE 直传）经「从对象存储选择文件」绑定 fileId，不重新上传；
 * - 权限：普通教师仅管理本人资源（RLS）；全平台发布仅项目管理员（数据库触发器强制）；
 * - 播放契约：fileId 入库 + playback 动态取带期限链接（默认 1 小时），fileId 不直接暴露给学生端。
 */
export default function TeacherResourcesPage() {
  return (
    <main>
      <LearningResourceManager />
    </main>
  );
}
