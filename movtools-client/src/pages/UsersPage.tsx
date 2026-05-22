/**
 * 用户管理页面
 *
 * 系统管理员在此页面管理用户、角色和项目成员。
 * 提供用户的创建、编辑、删除功能，以及角色分配功能。
 */
// React hooks
import { useEffect, useState, useMemo } from 'react';
// API客户端
import { apiClient } from '../api/client';
// 项目状态管理
import { useProjectStore } from '../stores/projectStore';
// 认证状态管理
import { useAuthStore } from '../auth/store';
// 权限工具
import { getPrimaryRole } from '../auth/permissions';

/**
 * 用户项接口
 * 表示系统中的用户对象
 */
interface ApiUserItem {
  /** 用户唯一标识 */
  userId: string;
  /** 用户名 */
  userName: string;
  /** 显示名称 */
  displayName: string;
  /** 角色列表 */
  roles: string[];
  /** 是否启用 */
  isActive: boolean;
}

interface UserItem {
  /** 用户唯一标识 */
  userId: string;
  /** 用户名 */
  username: string;
  /** 显示名称 */
  displayName: string;
  /** 角色列表 */
  roles: string[];
  /** 是否启用 */
  isActive: boolean;
}

/**
 * 角色项接口
 * 表示系统中的角色对象
 */
interface RoleItem {
  /** 角色唯一标识 */
  roleId: string;
  /** 角色代码 */
  code: string;
  /** 角色名称 */
  name: string;
  /** 显示名称 */
  displayName?: string;
  /** 是否为系统角色 */
  isSystem: boolean;
}

const roleLabelMap: Record<string, string> = {
  admin: '系统管理员',
  'system-admin': '系统管理员',
  producer: '制片',
  director: '导演',
  maker: '制作人员',
  viewer: '只读查看者',
};

function normalizeRoleCode(value: string): string {
  return value.trim().toLowerCase();
}

function getRoleDisplayName(role: RoleItem): string {
  return role.displayName || roleLabelMap[normalizeRoleCode(role.code)] || role.name;
}

function resolveRoleCodeFromLabel(value: string | null | undefined): string {
  const normalized = normalizeRoleCode(value ?? '');
  const matched = Object.entries(roleLabelMap).find(([, displayName]) => displayName === value?.trim());
  return matched?.[0] ?? normalized;
}

function getRoleLabel(value: string | null | undefined): string {
  const normalized = normalizeRoleCode(value ?? '');
  return roleLabelMap[normalized] ?? value ?? '只读查看者';
}

/**
 * 项目成员接口
 * 表示项目中的成员关系
 */
interface ProjectMember {
  /** 项目成员唯一标识 */
  projectMemberId: string;
  /** 项目代码 */
  projectCode: string;
  /** 用户ID */
  userId: string;
  /** 用户名 */
  userName: string;
  /** 显示名称 */
  displayName: string;
  /** 项目角色代码 */
  projectRoleCode: string;
  /** 是否启用 */
  isActive: boolean;
}

// 用户管理页面组件
export function UsersPage() {
  // 从项目Store获取项目列表
  const { projects } = useProjectStore();
  // 从认证Store获取当前用户信息
  const { user } = useAuthStore();
  
  // 判断当前用户角色
  const currentRole = useMemo(() => getPrimaryRole(user), [user]);
  // 是否为管理员（admin 或 system-admin）
  const isAdmin = useMemo(() => currentRole === 'admin' || currentRole === 'system-admin', [currentRole]);
  // 是否为制片（producer）- 制片只能管理项目成员
  const isProducer = useMemo(() => currentRole === 'producer', [currentRole]);
  
  // 用户列表状态
  const [users, setUsers] = useState<UserItem[]>([]);
  // 角色列表状态
  const [roles, setRoles] = useState<RoleItem[]>([]);
  // 项目成员列表状态
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  // 加载状态
  const [loading, setLoading] = useState(true);
  // 当前激活的标签页
  const [activeTab, setActiveTab] = useState<'users' | 'roles' | 'members'>('users');
  // 操作结果状态（成功/错误信息）
  const [result, setResult] = useState<{ success: boolean; error?: string }>({ success: true });
  // 选中的项目代码（用于项目成员标签页）
  const [selectedProjectCode, setSelectedProjectCode] = useState<string>('');

  // 添加用户对话框状态
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  // 新用户表单数据
  const [newUser, setNewUser] = useState({ username: '', displayName: '', password: '', role: '' });
  // 提交状态（防重复提交）
  const [submitting, setSubmitting] = useState(false);

  // 编辑角色对话框状态
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  // 已选择的角色列表
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  // 提交角色状态
  const [submittingRoles, setSubmittingRoles] = useState(false);

  // 编辑用户对话框状态
  const [editingUserId, setEditingUserId] = useState<string>('');
  // 编辑用户表单数据
  const [editUser, setEditUser] = useState({ username: '', displayName: '', password: '', role: '', isActive: true });
  // 提交编辑状态
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // 添加项目成员对话框状态
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  // 添加项目成员 - 选中的用户ID
  const [selectedUserIdToAdd, setSelectedUserIdToAdd] = useState<string>('');
  // 添加项目成员 - 选中的角色
  const [selectedProjectRole, setSelectedProjectRole] = useState<string>('maker');
  // 提交添加项目成员状态
  const [submittingAddMember, setSubmittingAddMember] = useState(false);

  // 获取可添加为项目成员的用户列表（排除已是项目成员的用户）
  const availableUsersForProject = useMemo(() => {
    if (!selectedProjectCode) return [];
    const existingMemberUserIds = projectMembers.map(m => m.userId);
    return users.filter(u => !existingMemberUserIds.includes(u.userId));
  }, [users, projectMembers, selectedProjectCode]);

   /**
    * 加载用户列表
    * 从后端API获取所有用户列表数据并更新状态
    * @returns Promise<void>
    */
   async function loadUsers(): Promise<void> {
     setLoading(true);
     try {
        const response = await apiClient.request<ApiUserItem[]>('/api/users', {
          method: 'GET'
        });
        setUsers(response.map((user) => ({
          userId: user.userId,
          username: user.userName,
          displayName: user.displayName,
          roles: user.roles.map((role) => resolveRoleCodeFromLabel(role)),
          isActive: user.isActive,
        })));
     } catch (error) {
       setResult({ success: false, error: error instanceof Error ? error.message : '加载用户失败' });
     } finally {
       setLoading(false);
     }
   }

   /**
    * 加载角色列表
    * 从后端API获取所有角色列表数据并更新状态
    * @param useLoading - 是否显示加载状态，默认true
    * @returns Promise<void>
    */
   async function loadRoles(useLoading = true): Promise<void> {
     if (useLoading) {
       setLoading(true);
     }
     try {
       const response = await apiClient.request<RoleItem[]>('/api/roles', {
         method: 'GET'
       });
        setRoles(response);
     } catch (error) {
       setResult({ success: false, error: error instanceof Error ? error.message : '加载角色失败' });
     } finally {
       if (useLoading) {
         setLoading(false);
       }
     }
   }

   /**
    * 加载项目成员列表
    * 根据选中的项目代码从后端API获取该项目下的所有成员列表数据
    * 如果未选择项目，则清空成员列表
    * @returns Promise<void>
    */
   async function loadProjectMembers(): Promise<void> {
     if (!selectedProjectCode) {
       setProjectMembers([]);
       setLoading(false);
       return;
     }

     setLoading(true);
     try {
       const response = await apiClient.request<ProjectMember[]>(`/api/project-members?projectCode=${encodeURIComponent(selectedProjectCode)}`, {
         method: 'GET'
       });
       setProjectMembers(response);
     } catch (error) {
       setResult({ success: false, error: error instanceof Error ? error.message : '加载项目成员失败' });
     } finally {
       setLoading(false);
     }
   }

   /**
    * 处理创建用户按钮点击事件
    * 验证表单数据，调用后端API创建新用户并分配角色
    * 创建成功后关闭对话框并刷新用户列表
    * @returns Promise<void>
    */
   async function handleCreateUser(): Promise<void> {
    if (!newUser.username || !newUser.displayName || !newUser.password || !newUser.role) {
      setResult({ success: false, error: '请填写所有字段' });
      return;
    }

    setSubmitting(true);
    try {
        const createdUser = await apiClient.request<ApiUserItem>('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            userName: newUser.username,
            displayName: newUser.displayName,
            password: newUser.password
          })
        });
        
        // Assign role to new user
        if (createdUser.userId) {
          await apiClient.request<void>(`/api/users/${createdUser.userId}/roles`, {
            method: 'POST',
            body: JSON.stringify({ roleCodes: [newUser.role] })
          });
        }
      
      setShowAddUserModal(false);
      setNewUser({ username: '', displayName: '', password: '', role: '' });
      await loadUsers();
      setResult({ success: true });
    } catch (error) {
      setResult({ success: false, error: error instanceof Error ? error.message : '创建用户失败' });
    } finally {
      setSubmitting(false);
    }
  }

/**
    * 处理删除用户按钮点击事件
    * 弹出确认对话框后，调用后端API删除指定的用户
    * 注意：admin用户不能被删除
    * @param userId - 要删除的用户ID
    * @returns Promise<void>
    */
   async function handleDeleteUser(userId: string): Promise<void> {
     if (!confirm('确定要删除此用户吗？此操作不可撤销。')) {
       return;
     }

     try {
       await apiClient.request<void>(`/api/users/${userId}`, {
         method: 'DELETE'
       });
       await loadUsers();
       setResult({ success: true });
     } catch (error) {
       setResult({ success: false, error: error instanceof Error ? error.message : '删除用户失败' });
     }
   }

   /**
    * 处理分配角色按钮点击事件
    * 验证已选择角色后，调用后端API为用户分配选中的角色
    * 分配成功后刷新用户列表
    * @returns Promise<void>
    */
   async function handleAssignRoles(): Promise<void> {
      if (!editingUser || selectedRoles.length === 0) {
        setResult({ success: false, error: '请至少选择一个角色' });
        return;
      }

      setSubmittingRoles(true);
      try {
        await apiClient.request<void>(`/api/users/${editingUser.userId}/roles`, {
          method: 'POST',
          body: JSON.stringify({ roleCodes: selectedRoles })
        });
        setEditingUser(null);
        setSelectedRoles([]);
        await loadUsers();
        setResult({ success: true });
      } catch (error) {
        setResult({ success: false, error: error instanceof Error ? error.message : '分配角色失败' });
      } finally {
        setSubmittingRoles(false);
      }
    }

/**
    * 处理编辑用户按钮点击事件
    * 验证表单数据后，调用后端API更新用户信息
    * 如果填写了角色，也会更新用户的角色
    * 成功编辑后清空表单并刷新用户列表
    * @returns Promise<void>
    */
    async function handleEditUser(): Promise<void> {
        const currentUser = users.find((user) => user.userId === editingUserId);
       const hasChanges = Boolean(editUser.username || editUser.displayName || editUser.password || editUser.role)
        || (currentUser ? editUser.isActive !== currentUser.isActive : false);

      if (!editingUserId || !hasChanges) {
        setResult({ success: false, error: '请至少填写一个字段' });
        return;
      }

     setSubmittingEdit(true);
     try {
        // Prepare update data - only include fields that are not empty
        const updateData: { userName?: string; displayName?: string; password?: string; isActive?: boolean } = {};
        if (editUser.username) updateData.userName = editUser.username;
        if (editUser.displayName) updateData.displayName = editUser.displayName;
        if (editUser.password) updateData.password = editUser.password;
        updateData.isActive = editUser.isActive;

       await apiClient.request<void>(`/api/users/${editingUserId}`, {
         method: 'PUT',
         body: JSON.stringify(updateData)
       });
       
        // If role is being updated, handle that separately
        const currentRole = currentUser?.roles[0] ?? '';
        const nextRole = resolveRoleCodeFromLabel(editUser.role);
        if (nextRole && nextRole !== currentRole) {
          await apiClient.request<void>(`/api/users/${editingUserId}/roles`, {
            method: 'POST',
            body: JSON.stringify({ roleCodes: [nextRole] })
          });
        }

       setEditingUserId('');
       setEditUser({ username: '', displayName: '', password: '', role: '', isActive: true });
       await loadUsers();
       setResult({ success: true });
     } catch (error) {
       setResult({ success: false, error: error instanceof Error ? error.message : '编辑用户失败' });
     } finally {
       setSubmittingEdit(false);
     }
   }

/**
     * 打开编辑角色对话框
     * 设置要编辑的用户并初始化已选择的角色列表
     * @param user - 要编辑的用户对象
     */
    function openEditRolesModal(user: UserItem) {
       setEditingUser(user);
       setSelectedRoles([...user.roles]);
    }

   /**
    * 处理添加项目成员
    * 调用后端API将选中的用户添加到项目中
    * @returns Promise<void>
    */
   async function handleAddProjectMember(): Promise<void> {
     if (!selectedProjectCode || !selectedUserIdToAdd || !selectedProjectRole) {
       setResult({ success: false, error: '请选择用户和项目角色' });
       return;
     }

     setSubmittingAddMember(true);
     try {
       await apiClient.request<void>(`/api/project-members`, {
         method: 'POST',
         body: JSON.stringify({
           projectCode: selectedProjectCode,
           userId: selectedUserIdToAdd,
           projectRoleCode: selectedProjectRole,
         })
       });
       setShowAddMemberModal(false);
       setSelectedUserIdToAdd('');
       setSelectedProjectRole('maker');
       await loadProjectMembers();
       setResult({ success: true });
     } catch (error) {
       setResult({ success: false, error: error instanceof Error ? error.message : '添加项目成员失败' });
     } finally {
       setSubmittingAddMember(false);
     }
   }

   /**
    * 处理移除项目成员
    * 调用后端API从项目中移除选中的成员
    * @param projectMemberId - 项目成员ID
    * @returns Promise<void>
    */
   async function handleRemoveProjectMember(projectMemberId: string): Promise<void> {
     if (!confirm('确定要从此项目移除该成员吗？')) {
       return;
     }

     try {
       await apiClient.request<void>(`/api/project-members/${projectMemberId}`, {
         method: 'DELETE'
       });
       await loadProjectMembers();
       setResult({ success: true });
     } catch (error) {
       setResult({ success: false, error: error instanceof Error ? error.message : '移除项目成员失败' });
     }
   }

   /**
    * 打开编辑用户对话框
    * 设置要编辑的用户ID并初始化表单数据
    * 注意：出于安全考虑，不预填密码
    * @param user - 要编辑的用户对象
    */
   function openEditUserModal(user: UserItem) {
      setEditingUserId(user.userId);
      setEditUser({
        username: user.username,
        displayName: user.displayName,
        password: '', // Don't pre-fill password for security
        role: user.roles[0] || '', // Set first role if exists
        isActive: user.isActive,
      });
    }

   /**
    * 标签页切换效果
    * 当激活的标签页或选中的项目代码发生变化时，加载相应的数据
    */
/**
    * 标签页切换效果
    * 当激活的标签页或选中的项目代码发生变化时，加载相应的数据
    */
   useEffect(() => {
     if (activeTab === 'users') {
       void loadUsers();
     } else if (activeTab === 'roles') {
       void loadRoles();
     } else if (activeTab === 'members') {
       void loadProjectMembers();
     }
   }, [activeTab, selectedProjectCode]);

   /**
    * 初始化角色列表效果
    * 在组件挂载时加载角色列表（不显示加载状态）
    * 用于为添加用户/编辑用户表单提供角色选项
    */
   useEffect(() => {
     void loadRoles(false);
   }, []);

  return (
    <section className="page-layout">
      <header className="page-header">
        <div>
          <p className="eyebrow">{isAdmin ? '用户管理' : '项目成员管理'}</p>
          <h2>{isAdmin ? '用户与权限管理' : '项目成员管理'}</h2>
          <div className="page-header-tags">
            {isAdmin && <span className="page-header-tag">用户管理</span>}
            {isAdmin && <span className="page-header-tag">角色配置</span>}
            {isProducer && <span className="page-header-tag">项目成员</span>}
          </div>
        </div>
        <div className="page-header-actions">
          <p className="muted">{isAdmin ? '系统管理员只管理用户与角色' : '制片可管理项目成员'}</p>
        </div>
      </header>

      <div className="tab-bar">
        {isAdmin && <button className={activeTab === 'users' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('users')} type="button">用户列表</button>}
        {isAdmin && <button className={activeTab === 'roles' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('roles')} type="button">角色配置</button>}
        {isProducer && <button className={activeTab === 'members' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('members')} type="button">项目成员</button>}
      </div>

      <div className="panel">
        {loading ? (
          <p className="muted">加载中...</p>
        ) : activeTab === 'users' ? (
          <>
            <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="button button--primary" onClick={() => setShowAddUserModal(true)} type="button">
                + 添加用户
              </button>
            </div>
            {users.length === 0 ? (
              <p className="muted">暂无用户数据</p>
            ) : (
              <div className="user-list">
                {users.map((user) => (
                  <article className="user-card" key={user.userId}>
                    <div className="section-heading">
                      <div>
                        <h4>{user.username}</h4>
                        <p className="muted">显示名称：{user.displayName || '未设置'}</p>
                      </div>
                      <span className={`status-pill ${user.isActive ? '' : 'status-pill--inactive'}`}>
                        {user.isActive ? '启用' : '停用'}
                      </span>
                    </div>
                    <div className="stack-gap compact-gap">
                      <small className="muted">角色：{user.roles.length > 0 ? user.roles.map((role) => getRoleLabel(role)).join(' · ') : '无'}</small>
                    </div>
                    <div className="user-card-actions">
                        <button 
                          className="ghost-button ghost-button--compact" 
                          onClick={() => openEditRolesModal(user)}
                         type="button"
                       >
                         分配角色
                       </button>
                       <button 
                         className="ghost-button ghost-button--compact" 
                         onClick={() => openEditUserModal(user)}
                         type="button"
                       >
                         编辑
                       </button>
                        {user.username !== 'admin' && (
                          <button 
                            className="ghost-button ghost-button--compact ghost-button--danger" 
                            onClick={() => handleDeleteUser(user.userId)}
                           type="button"
                         >
                           删除
                         </button>
                       )}
                     </div>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : activeTab === 'roles' ? (
          roles.length === 0 ? (
            <p className="muted">暂无角色配置</p>
          ) : (
            <div className="role-list">
              {roles.map((role) => (
                <article className="role-card" key={role.roleId}>
                  <div className="section-heading">
                    <div>
                      <h4>{getRoleDisplayName(role)}</h4>
                      <p className="muted">代码：{role.code}{role.isSystem ? ' · 系统角色' : ''}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )
        ) : isProducer && activeTab === 'members' ? (
            <>
              <div className="filter-bar">
                <label className="field" style={{ marginBottom: 0 }}>
                  <span>选择项目</span>
                  <select value={selectedProjectCode} onChange={(e) => setSelectedProjectCode(e.target.value)}>
                    <option value="">请选择项目...</option>
                    {projects.map((p) => (
                      <option key={p.projectId} value={p.projectId}>{p.projectName}</option>
                    ))}
                  </select>
                </label>
                {selectedProjectCode && <p className="muted" style={{ margin: 0 }}>成员管理已迁移到项目页；这里仅保留查询视图。</p>}
              </div>
              {!selectedProjectCode ? (
                <p className="muted">请选择一个项目以查看其成员</p>
              ) : projectMembers.length === 0 ? (
                <p className="muted">暂无项目成员数据</p>
              ) : (
                <div className="member-list">
                  {projectMembers.map((member) => (
                    <article className="member-card" key={member.projectMemberId}>
                      <div className="section-heading">
                        <div>
                          <h4>{member.displayName}</h4>
                          <p className="muted">用户名：{member.userName}</p>
                        </div>
                        <span className="status-pill">{member.projectRoleCode}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : null}
      </div>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="modal-overlay" onClick={() => setShowAddUserModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>添加用户</h3>
              <button className="modal-close" onClick={() => setShowAddUserModal(false)} type="button">×</button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>用户名 *</span>
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  placeholder="请输入用户名"
                />
              </label>
              <label className="field">
                <span>显示名称 *</span>
                <input
                  type="text"
                  value={newUser.displayName}
                  onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                  placeholder="请输入显示名称"
                />
              </label>
              <label className="field">
                <span>密码 *</span>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="请输入密码"
                />
              </label>
              <label className="field">
                <span>角色 *</span>
                <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                   <option value="">请选择角色...</option>
                   {roles.map((role) => (
                     <option key={role.roleId} value={role.code}>{getRoleDisplayName(role)}</option>
                   ))}
                </select>
              </label>
            </div>
            <div className="modal-footer">
              <button className="ghost-button" onClick={() => setShowAddUserModal(false)} type="button">取消</button>
              <button 
                className="button button--primary" 
                onClick={handleCreateUser}
                disabled={submitting}
                type="button"
              >
                {submitting ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

       {/* Edit Roles Modal */}
       {editingUser && (
         <div className="modal-overlay" onClick={() => setEditingUser(null)}>
           <div className="modal" onClick={(e) => e.stopPropagation()}>
             <div className="modal-header">
        <h3>替换角色 - {editingUser.displayName}</h3>
               <button className="modal-close" onClick={() => setEditingUser(null)} type="button">×</button>
             </div>
             <div className="modal-body">
               <fieldset className="field">
                  <legend>选择角色（将替换当前角色）</legend>
                 <div className="checkbox-group">
                   {roles.map((role) => (
                     <label key={role.roleId} className="checkbox-label">
                       <input
                         type="checkbox"
                         checked={selectedRoles.includes(role.code)}
                         onChange={(e) => {
                           if (e.target.checked) {
                             setSelectedRoles([...selectedRoles, role.code]);
                           } else {
                             setSelectedRoles(selectedRoles.filter(r => r !== role.code));
                           }
                         }}
                       />
                         <span>{getRoleDisplayName(role)}</span>
                     </label>
                   ))}
                 </div>
               </fieldset>
             </div>
             <div className="modal-footer">
               <button className="ghost-button" onClick={() => setEditingUser(null)} type="button">取消</button>
               <button 
                 className="button button--primary" 
                 onClick={handleAssignRoles}
                 disabled={submittingRoles}
                 type="button"
               >
                 {submittingRoles ? '保存中...' : '保存'}
               </button>
             </div>
           </div>
         </div>
       )}

{/* Add Project Member Modal */}
        {showAddMemberModal && (
          <div className="modal-overlay" onClick={() => setShowAddMemberModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>添加项目成员</h3>
                <button className="modal-close" onClick={() => setShowAddMemberModal(false)} type="button">×</button>
              </div>
              <div className="modal-body">
                <label className="field">
                  <span>选择用户 *</span>
                  <select value={selectedUserIdToAdd} onChange={(e) => setSelectedUserIdToAdd(e.target.value)}>
                    <option value="">请选择用户...</option>
                    {availableUsersForProject.map((user) => (
                      <option key={user.userId} value={user.userId}>{user.displayName || user.username} ({user.username})</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>项目角色 *</span>
                  <select value={selectedProjectRole} onChange={(e) => setSelectedProjectRole(e.target.value)}>
                    <option value="producer">制片</option>
                    <option value="director">导演</option>
                    <option value="maker">制作人员</option>
                  </select>
                </label>
              </div>
              <div className="modal-footer">
                <button className="ghost-button" onClick={() => setShowAddMemberModal(false)} type="button">取消</button>
                <button 
                  className="button button--primary" 
                  onClick={handleAddProjectMember}
                  disabled={submittingAddMember || !selectedUserIdToAdd || !selectedProjectRole}
                  type="button"
                >
                  {submittingAddMember ? '添加中...' : '添加'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit User Modal */}
        {editingUserId && (
         <div className="modal-overlay" onClick={() => setEditingUserId('')}>
           <div className="modal" onClick={(e) => e.stopPropagation()}>
             <div className="modal-header">
               <h3>编辑用户</h3>
               <button className="modal-close" onClick={() => setEditingUserId('')} type="button">×</button>
             </div>
             <div className="modal-body">
               <label className="field">
                 <span>用户名 *</span>
                 <input
                   type="text"
                   value={editUser.username}
                   onChange={(e) => setEditUser({ ...editUser, username: e.target.value })}
                   placeholder="请输入用户名"
                 />
               </label>
               <label className="field">
                 <span>显示名称 *</span>
                 <input
                   type="text"
                   value={editUser.displayName}
                   onChange={(e) => setEditUser({ ...editUser, displayName: e.target.value })}
                   placeholder="请输入显示名称"
                 />
               </label>
               <label className="field">
                 <span>密码</span>
                 <input
                   type="password"
                   value={editUser.password}
                   onChange={(e) => setEditUser({ ...editUser, password: e.target.value })}
                   placeholder="留空则不修改密码"
                 />
               </label>
                <label className="field">
                  <span>角色 *</span>
                  <select value={editUser.role} onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}>
                    <option value="">请选择角色...</option>
                    {roles.map((role) => (
                     <option key={role.roleId} value={role.code}>{getRoleDisplayName(role)}</option>
                    ))}
                  </select>
                </label>
                <label className="field checkbox-label">
                  <input
                    checked={editUser.isActive}
                    onChange={(e) => setEditUser({ ...editUser, isActive: e.target.checked })}
                    type="checkbox"
                  />
                  <span>启用用户</span>
                </label>
              </div>
             <div className="modal-footer">
               <button className="ghost-button" onClick={() => setEditingUserId('')} type="button">取消</button>
               <button 
                 className="button button--primary" 
                 onClick={handleEditUser}
                 disabled={submittingEdit}
                 type="button"
               >
                 {submittingEdit ? '保存中...' : '保存'}
               </button>
             </div>
           </div>
         </div>
       )}

      {result.error && (
        <div className="danger-copy">
          {result.error}
          <button onClick={() => setResult({ success: true })} type="button">关闭</button>
        </div>
      )}
    </section>
  );
}
