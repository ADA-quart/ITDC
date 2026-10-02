/**
 * 学校教务系统配置注册表。
 *
 * 每所学校的统一认证（CAS）+ 教务系统接入参数集中在这里，
 * 服务器端导入路由按 schoolId 取配置执行登录/抓课表。
 * 新增学校 = 加一个常量条目，不改代码逻辑。
 */

export interface SchoolConfig {
  /** 稳定标识，存进用户设置（如 "cdut"） */
  id: string;
  /** 显示名 */
  name: string;
  /** 统一认证基础地址 */
  casBase: string;
  /** 教务系统基础地址 */
  jwBase: string;
  /** 教务 SSO 入口路径（从 CAS 跳转教务） */
  jwSsoPath: string;
  /** 学期个人课表页面路径 */
  timetablePath: string;
  /** SSO 重定向跟随上限 */
  ssoMaxRedirects: number;
}

export const SCHOOLS: Record<string, SchoolConfig> = {
  cdut: {
    id: 'cdut',
    name: '成都理工大学',
    casBase: 'https://cas.paas.cdut.edu.cn/cas',
    jwBase: 'https://jw.cdut.edu.cn',
    jwSsoPath: '/sso/login.jsp',
    timetablePath: '/jsxsd/xskb/xskb_list.do',
    ssoMaxRedirects: 10,
  },
};

/** 按 id 取配置，未知 id 返回 undefined */
export function getSchool(id: string | undefined | null): SchoolConfig | undefined {
  if (!id) return undefined;
  return SCHOOLS[id];
}

/** 所有已支持学校（用于前端下拉） */
export function listSchools(): Array<{ id: string; name: string }> {
  return Object.values(SCHOOLS).map(({ id, name }) => ({ id, name }));
}
