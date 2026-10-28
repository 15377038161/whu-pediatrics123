/** Historical released-media IDs only: keep immutable URLs for authorized old-session replay.
 * The three AI-only cases have no active catalogue, import or training entry. */
export const TEACHING_ILLUSTRATIONS: Readonly<Record<string, {url: string; label: string}>> = {
  'teaching-illustration:v1:pneumonia': {url:'/media/teaching/v1/pneumonia.png',label:'AI生成·教学示意，非真实患者影像'},
  'teaching-illustration:v1:neonatal-stroke': {url:'/media/teaching/v1/neonatal-stroke.png',label:'AI生成·教学示意，非真实患者影像'},
  'teaching-illustration:v1:gbs': {url:'/media/teaching/v1/gbs.png',label:'AI生成·教学示意，非真实患者影像'},
};
