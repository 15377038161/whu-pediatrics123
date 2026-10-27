/** Public conceptual assets; never patient images or diagnostic scans. Versioned IDs are immutable. */
export const TEACHING_ILLUSTRATIONS: Readonly<Record<string, {url: string; label: string}>> = {
  'teaching-illustration:v1:pneumonia': {url:'/media/teaching/v1/pneumonia.png',label:'AI生成·教学示意，非真实患者影像'},
  'teaching-illustration:v1:neonatal-stroke': {url:'/media/teaching/v1/neonatal-stroke.png',label:'AI生成·教学示意，非真实患者影像'},
  'teaching-illustration:v1:gbs': {url:'/media/teaching/v1/gbs.png',label:'AI生成·教学示意，非真实患者影像'},
};
