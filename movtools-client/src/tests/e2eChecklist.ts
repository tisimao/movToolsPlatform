/**
 * 端到端验收与回归清单
 * 
 * 本文件定义客户端的完整验收测试用例
 * 用于验证客户端核心功能与第六批初始化链路的可用性
 */

// ============================================
// 测试用例定义
// ============================================

export interface TestCase {
  id: string;
  category: string;
  name: string;
  steps: string[];
  expectedResult: string;
  status: 'pending' | 'passed' | 'failed';
  notes?: string;
}

export interface TestResult {
  caseId: string;
  status: 'passed' | 'failed';
  executedAt: string;
  error?: string;
}

/**
 * 第五批客户端测试用例清单
 */
export const e2eTestCases: TestCase[] = [
  // ========================================
  // C-08 导演审片页面与评论能力
  // ========================================
  {
    id: 'C-08-01',
    category: '审片',
    name: '导演待审列表加载',
    steps: [
      '1. 使用导演账号登录客户端',
      '2. 进入审片页面',
      '3. 等待待审列表加载'
    ],
    expectedResult: '待审列表成功加载，显示待审镜头',
    status: 'pending'
  },
  {
    id: 'C-08-02',
    category: '审片',
    name: '普通评论提交',
    steps: [
      '1. 选择一个待审镜头',
      '2. 在评论框输入评论内容',
      '3. 点击提交评论'
    ],
    expectedResult: '评论提交成功，列表刷新显示新评论',
    status: 'pending'
  },
  {
    id: 'C-08-03',
    category: '审片',
    name: '时间点批注提交',
    steps: [
      '1. 选择一个待审镜头',
      '2. 勾选"时间点批注"',
      '3. 输入时间点和评论内容',
      '4. 点击提交评论'
    ],
    expectedResult: '时间点批注提交成功，显示时间戳标记',
    status: 'pending'
  },
  {
    id: 'C-08-04',
    category: '审片',
    name: '返修操作',
    steps: [
      '1. 选择一个待审镜头',
      '2. 可选填写返修意见',
      '3. 点击"返修"按钮',
      '4. 确认操作'
    ],
    expectedResult: '镜头状态变为"已返修"，列表更新',
    status: 'pending'
  },
  {
    id: 'C-08-05',
    category: '审片',
    name: '通过操作',
    steps: [
      '1. 选择一个待审镜头',
      '2. 可选填写通过意见',
      '3. 点击"通过"按钮',
      '4. 确认操作'
    ],
    expectedResult: '镜头状态变为"已通过"，列表更新',
    status: 'pending'
  },

  // ========================================
  // C-09 路径映射设置与本地路径解析
  // ========================================
  {
    id: 'C-09-01',
    category: '路径映射',
    name: '路径根列表加载',
    steps: [
      '1. 进入路径映射设置页面',
      '2. 等待路径根列表加载'
    ],
    expectedResult: '路径根列表成功加载',
    status: 'pending'
  },
  {
    id: 'C-09-02',
    category: '路径映射',
    name: '路径映射保存',
    steps: [
      '1. 在路径映射页面',
      '2. 选择一个路径根',
      '3. 配置本地路径',
      '4. 点击保存'
    ],
    expectedResult: '路径映射保存成功',
    status: 'pending'
  },
  {
    id: 'C-09-03',
    category: '路径映射',
    name: '逻辑路径解析',
    steps: [
      '1. 在审片页面选择镜头',
      '2. 点击预览按钮'
    ],
    expectedResult: '逻辑路径成功解析为本地路径',
    status: 'pending'
  },
  {
    id: 'C-09-04',
    category: '路径映射',
    name: '本地视频预览',
    steps: [
      '1. 配置好路径映射',
      '2. 选择有可用文件的镜头',
      '3. 点击预览'
    ],
    expectedResult: '本地播放器打开视频文件',
    status: 'pending'
  },

  // ========================================
  // C-10 同步机制
  // ========================================
  {
    id: 'C-10-01',
    category: '同步',
    name: '在线 push',
    steps: [
      '1. 确保网络连接正常',
      '2. 修改镜头状态',
      '3. 提交审片意见'
    ],
    expectedResult: '修改立即同步到服务端',
    status: 'pending'
  },
  {
    id: 'C-10-02',
    category: '同步',
    name: '离线 outbox 缓存',
    steps: [
      '1. 断开网络连接',
      '2. 进行操作（如评论）',
      '3. 观察提示'
    ],
    expectedResult: '操作进入 outbox 缓存',
    status: 'pending'
  },
  {
    id: 'C-10-03',
    category: '同步',
    name: '恢复网络后自动同步',
    steps: [
      '1. 保持 outbox 有待同步记录',
      '2. 恢复网络连接',
      '3. 等待自动同步'
    ],
    expectedResult: 'outbox 清空并同步成功',
    status: 'pending'
  },
  {
    id: 'C-10-04',
    category: '同步',
    name: '增量拉取',
    steps: [
      '1. 在另一客户端修改数据',
      '2. 本客户端手动触发同步',
      '3. 观察数据更新'
    ],
    expectedResult: '按序号拉取新变更成功',
    status: 'pending'
  },

  // ========================================
  // C-11 SignalR 实时刷新
  // ========================================
  {
    id: 'C-11-01',
    category: 'SignalR',
    name: 'SignalR 建连',
    steps: [
      '1. 登录客户端',
      '2. 等待 SignalR 连接'
    ],
    expectedResult: 'SignalR 连接成功',
    status: 'pending'
  },
  {
    id: 'C-11-02',
    category: 'SignalR',
    name: '镜头更新刷新',
    steps: [
      '1. 在另一客户端修改镜头',
      '2. 本客户端观察自动刷新'
    ],
    expectedResult: '本客户端自动刷新镜头列表',
    status: 'pending'
  },
  {
    id: 'C-11-03',
    category: 'SignalR',
    name: '审片评论刷新',
    steps: [
      '1. 在另一客户端新增评论',
      '2. 本客户端观察刷新'
    ],
    expectedResult: '本客户端自动刷新评论列表',
    status: 'pending'
  },
  {
    id: 'C-11-04',
    category: 'SignalR',
    name: '断线重连',
    steps: [
      '1. SignalR 已连接',
      '2. 断开网络',
      '3. 观察重连',
      '4. 恢复网络'
    ],
    expectedResult: 'SignalR 自动重连成功',
    status: 'pending'
  },

  // ========================================
  // C-12 本地文件能力
  // ========================================
  {
    id: 'C-12-01',
    category: '本地能力',
    name: '文件检查运行',
    steps: [
      '1. 进入文件检查页面',
      '2. 配置扫描根',
      '3. 执行 layout 扫描'
    ],
    expectedResult: '文件检查执行成功，显示结果',
    status: 'pending'
  },
  {
    id: 'C-12-02',
    category: '本地能力',
    name: '本地预览运行',
    steps: [
      '1. 在镜头详情页面',
      '2. 点击预览按钮'
    ],
    expectedResult: '本地播放器打开视频',
    status: 'pending'
  },
  {
    id: 'C-12-03',
    category: '本地能力',
    name: 'FFmpeg 任务运行',
    steps: [
      '1. 进入提取或其他 FFmpeg 页面',
      '2. 配置任务参数',
      '3. 执行任务'
    ],
    expectedResult: 'FFmpeg 任务执行成功',
    status: 'pending'
  },

  // ========================================
  // C-13 错误处理
  // ========================================
  {
    id: 'C-13-01',
    category: '远端路径',
    name: 'producer 项目激活',
    steps: [
      '1. 使用 producer 账号登录',
      '2. 打开仪表盘',
      '3. 点击已配置 roots 的协同项目激活'
    ],
    expectedResult: '项目激活成功，工作区同步刷新',
    status: 'pending'
  },
  {
    id: 'C-13-02',
    category: '远端路径',
    name: 'maker 项目激活',
    steps: [
      '1. 使用 maker 账号登录',
      '2. 进入项目页或仪表盘',
      '3. 激活同一协同项目'
    ],
    expectedResult: 'maker 可成功激活同一项目并进入工作区',
    status: 'pending'
  },
  {
    id: 'C-13-03',
    category: '远端路径',
    name: '集切换成功',
    steps: [
      '1. 在已激活项目中选择其他集',
      '2. 点击设为当前集'
    ],
    expectedResult: '集切换成功，路径规则与项目激活保持一致',
    status: 'pending'
  },
  {
    id: 'C-13-04',
    category: '远端路径',
    name: '盘符重定位',
    steps: [
      '1. 将服务端路径与本机路径保持相同后缀',
      '2. 仅变更盘符',
      '3. 执行项目激活'
    ],
    expectedResult: '客户端自动重定位成功',
    status: 'pending'
  },
  {
    id: 'C-13-05',
    category: '远端路径',
    name: '历史 description 兼容',
    steps: [
      '1. 使用仅回填 description 的历史数据',
      '2. 执行项目激活'
    ],
    expectedResult: '历史数据仍可通过兼容兜底激活成功',
    status: 'pending'
  },

  // ========================================
  // C-14 端到端主链路
  // ========================================
  {
    id: 'C-14-01',
    category: 'E2E',
    name: '完整审片闭环',
    steps: [
      '1. 制片账号登录',
      '2. 打开镜头详情',
      '3. 提交审片',
      '4. 切换导演账号',
      '5. 审片并评论',
      '6. 返修/通过'
    ],
    expectedResult: '完整审片闭环成功',
    status: 'pending'
  },
  {
    id: 'C-14-02',
    category: 'E2E',
    name: '路径映射链路',
    steps: [
      '1. 配置路径映射',
      '2. 进入镜头详情',
      '3. 发起本地预览'
    ],
    expectedResult: '本地预览成功打开',
    status: 'pending'
  },
  {
    id: 'C-14-03',
    category: 'E2E',
    name: '离线恢复链路',
    steps: [
      '1. 断开网络',
      '2. 进行操作',
      '3. 恢复网络',
      '4. 等待自动同步'
    ],
    expectedResult: '离线操作在恢复后同步成功',
    status: 'pending'
  },
  {
    id: 'C-14-04',
    category: 'E2E',
    name: '本地能力回归',
    steps: [
      '1. 文件检查',
      '2. 本地预览',
      '3. FFmpeg 任务'
    ],
    expectedResult: '本地核心能力未倒退',
    status: 'pending'
  },

  // ========================================
  // 制片测试联调调整修正批次
  // ========================================
  {
    id: 'PROD-01',
    category: '制片创建项目',
    name: '制片创建项目成功',
    steps: [
      '1. 使用制片账号登录客户端',
      '2. 切换到协同模式',
      '3. 进入项目页面',
      '4. 填写项目名称和根目录',
      '5. 配置镜头根目录和Layout根目录',
      '6. 点击创建项目'
    ],
    expectedResult: '项目创建成功，显示成功提示',
    status: 'pending'
  },
  {
    id: 'PROD-02',
    category: '制片创建项目',
    name: '创建项目时初始化参数透传成功',
    steps: [
      '1. 使用制片账号登录客户端',
      '2. 填写项目初始化信息',
      '3. 配置 initExcelPath',
      '4. 配置 lensRoots 和 layoutRoots',
      '5. 创建项目'
    ],
    expectedResult: '服务端接收到完整的初始化参数',
    status: 'pending'
  },
  {
    id: 'PROD-03',
    category: '制片创建项目',
    name: '创建项目时选择制作人员成功',
    steps: [
      '1. 使用制片账号登录客户端',
      '2. 进入创建项目页面',
      '3. 在项目成员选择区域选择制作人员',
      '4. 创建项目'
    ],
    expectedResult: '成功选择并添加项目成员到新项目',
    status: 'pending'
  },
  {
    id: 'PROD-04',
    category: '制片创建项目',
    name: '创建完成后看到初始化结果',
    steps: [
      '1. 创建项目后查看返回结果',
      '2. 检查是否有初始化相关信息'
    ],
    expectedResult: '显示项目创建成功及成员选择结果',
    status: 'pending'
  },
  {
    id: 'PROD-05',
    category: '制片创建项目',
    name: '本地镜头文件夹建立成功',
    steps: [
      '1. 创建项目后检查本地目录',
      '2. 验证镜头文件夹是否创建'
    ],
    expectedResult: '本地镜头文件夹按配置创建',
    status: 'pending'
  },
  {
    id: 'PROD-06',
    category: '制片成员管理',
    name: '制片可查看项目成员列表',
    steps: [
      '1. 使用制片账号登录',
      '2. 进入用户与权限管理页面',
      '3. 切换到项目成员标签'
    ],
    expectedResult: '制片可以访问成员管理页面',
    status: 'pending'
  },
  {
    id: 'PROD-07',
    category: '制片成员管理',
    name: '制片可新增项目成员',
    steps: [
      '1. 使用制片账号登录',
      '2. 进入项目成员管理',
      '3. 选择一个项目',
      '4. 点击添加成员按钮',
      '5. 选择用户和角色',
      '6. 确认添加'
    ],
    expectedResult: '成功添加项目成员',
    status: 'pending'
  },
  {
    id: 'PROD-08',
    category: '制作人员权限',
    name: 'maker登录后可编辑镜头',
    steps: [
      '1. 使用maker账号登录',
      '2. 进入项目（作为项目成员）',
      '3. 选择集',
      '4. 打开镜头详情',
      '5. 编辑镜头信息',
      '6. 保存'
    ],
    expectedResult: 'maker可以成功编辑镜头',
    status: 'pending'
  },
  {
    id: 'PROD-09',
    category: '制作人员权限',
    name: '非项目成员编辑镜头失败或被正确阻断',
    steps: [
      '1. 使用非项目成员账号登录',
      '2. 尝试进入不属于自己项目的镜头',
      '3. 尝试编辑镜头'
    ],
    expectedResult: '被拒绝访问或提示无权限',
    status: 'pending'
  },
  {
    id: 'PROD-10',
    category: '错误处理',
    name: '初始化失败时页面提示明确',
    steps: [
      '1. 模拟初始化失败场景',
      '2. 检查错误提示'
    ],
    expectedResult: '显示清晰的错误信息',
    status: 'pending'
  },
  {
    id: 'PROD-11',
    category: '第六批初始化',
    name: '旧 Excel 可本地解析',
    steps: [
      '1. 使用旧项目真实在用的 .xls 文件',
      '2. 配置旧表头映射',
      '3. 创建项目并触发初始化'
    ],
    expectedResult: '客户端本地解析旧 Excel 成功，能生成镜头同步数据',
    status: 'pending'
  },
  {
    id: 'PROD-12',
    category: '第六批初始化',
    name: '初始化状态语义正确',
    steps: [
      '1. 分别模拟未请求初始化、跳过、本地解析失败、镜头同步失败、文件夹创建失败、全部成功',
      '2. 查看项目创建结果'
    ],
    expectedResult: '页面能区分 not_requested、skipped、failed、partial_success、success',
    status: 'pending'
  },
  {
    id: 'PROD-13',
    category: '第六批初始化',
    name: '远程镜头批量同步完成',
    steps: [
      '1. 创建项目并成功创建首集',
      '2. 检查批量同步请求',
      '3. 确认服务端已落库镜头'
    ],
    expectedResult: '客户端在首集上下文就绪后批量同步镜头成功',
    status: 'pending'
  },
  {
    id: 'PROD-14',
    category: '第六批初始化',
    name: '真实镜头文件夹创建完成',
    steps: [
      '1. 批量同步镜头成功后',
      '2. 检查本地镜头根目录',
      '3. 核对实际创建的镜头文件夹'
    ],
    expectedResult: '本地镜头文件夹按真实镜头记录创建完成',
    status: 'pending'
  },
  {
    id: 'PROD-15',
    category: '权限回归',
    name: 'maker 仍可编辑镜头',
    steps: [
      '1. 使用 maker 账号登录',
      '2. 进入项目与集',
      '3. 打开镜头详情并编辑'
    ],
    expectedResult: 'maker 编辑镜头能力保持可用',
    status: 'pending'
  },
];

/**
 * 获取测试用例列表
 */
export function getTestCases(): TestCase[] {
  return e2eTestCases;
}

/**
 * 按分类获取测试用例
 */
export function getTestCasesByCategory(category: string): TestCase[] {
  return e2eTestCases.filter(tc => tc.category === category);
}

/**
 * 获取待执行的测试用例
 */
export function getPendingTestCases(): TestCase[] {
  return e2eTestCases.filter(tc => tc.status === 'pending');
}

/**
 * 记录测试结果
 */
export function recordTestResult(result: TestResult): void {
  const testCase = e2eTestCases.find(tc => tc.id === result.caseId);
  if (testCase) {
    testCase.status = result.status;
    testCase.notes = result.error;
  }
}

/**
 * 获取测试统计
 */
export function getTestStats(): { total: number; passed: number; failed: number; pending: number } {
  const passed = e2eTestCases.filter(tc => tc.status === 'passed').length;
  const failed = e2eTestCases.filter(tc => tc.status === 'failed').length;
  const pending = e2eTestCases.filter(tc => tc.status === 'pending').length;
  
  return {
    total: e2eTestCases.length,
    passed,
    failed,
    pending,
  };
}
