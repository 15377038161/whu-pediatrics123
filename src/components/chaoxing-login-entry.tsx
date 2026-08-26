'use client';

import { useState } from 'react';
import { ArrowRight, GraduationCap } from 'lucide-react';
import type { ChaoxingLoginOptions } from '@/lib/chaoxing-client';

export function ChaoxingLoginEntry({ configured, institutions }: ChaoxingLoginOptions) {
  const [fid, setFid] = useState('');
  const [pending, setPending] = useState(false);

  if (!configured) {
    return (
      <button className="btn btn-primary btn-block" type="button" disabled>
        <GraduationCap size={19} /> 超星认证尚未配置
      </button>
    );
  }

  const login = () => {
    setPending(true);
    window.location.assign(fid ? `/api/auth/chaoxing?fid=${encodeURIComponent(fid)}` : '/api/auth/chaoxing');
  };

  return (
    <div className="chaoxing-login-entry">
      {institutions.length > 0 && (
        <label className="login-field">
          <span>所属机构</span>
          <select value={fid} onChange={(event) => setFid(event.target.value)} disabled={pending}>
            <option value="">请选择所属机构</option>
            {institutions.map((institution) => (
              <option key={institution.fid} value={institution.fid}>
                {institution.name === institution.fid
                  ? institution.fid
                  : `${institution.name}（${institution.fid}）`}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        className="btn btn-primary btn-block"
        type="button"
        onClick={login}
        disabled={pending || (institutions.length > 0 && !fid)}
      >
        <GraduationCap size={19} />
        {pending ? '正在连接超星…' : '使用超星账号进入'}
        {!pending && <ArrowRight size={17} />}
      </button>
    </div>
  );
}
