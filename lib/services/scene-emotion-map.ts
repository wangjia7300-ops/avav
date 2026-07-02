export type SceneEmotionMap = {
  categoryGroup: string;
  commonScenes: string[];
  commonPains: string[];
  commonDesires: string[];
  emotionalTriggers: string[];
};

const maps: SceneEmotionMap[] = [
  {
    categoryGroup: "小家电",
    commonScenes: ["客厅休息时", "卧室睡前", "厨房忙碌时", "办公室工位", "小户型空间"],
    commonPains: ["来回调整很麻烦", "长时间用怕打扰", "空间不够好摆放", "使用步骤不想太复杂"],
    commonDesires: ["少折腾一点", "用得更轻松", "摆放更灵活", "家里更舒服"],
    emotionalTriggers: ["轻松", "少麻烦", "安心", "清爽"]
  },
  {
    categoryGroup: "厨房用品",
    commonScenes: ["下班做饭时", "早餐准备时", "厨房收拾时", "多人用餐前", "周末备菜时"],
    commonPains: ["准备过程太耗时", "清洗收纳麻烦", "台面容易乱", "步骤多容易打断"],
    commonDesires: ["做饭更顺手", "台面更清楚", "收拾更快", "少一点厨房负担"],
    emotionalTriggers: ["省事", "利落", "松弛", "有秩序"]
  },
  {
    categoryGroup: "食品饮品",
    commonScenes: ["办公室下午茶", "餐后想解腻时", "朋友到访时", "送礼挑选时", "第一次尝试时"],
    commonPains: ["怕味道太浓太苦", "怕配料或产地看不懂", "怕送礼不够体面", "怕开封后不好保存"],
    commonDesires: ["入口更轻松", "选择更快", "送出去更稳妥", "保存拿取更省事"],
    emotionalTriggers: ["安心", "体面", "轻松", "少纠结"]
  },
  {
    categoryGroup: "生鲜食品",
    commonScenes: ["厨房备菜时", "餐桌摆盘时", "凉拌生吃时", "给家人加餐时", "冰箱拿取时"],
    commonPains: ["怕不够新鲜不够熟", "怕催熟没有果味", "怕口感酸涩发柴", "怕运输磕碰坏果", "怕到货不新鲜"],
    commonDesires: ["新鲜看得见", "自然成熟有果味", "洗了就能吃", "口感沙甜多汁", "到货依然新鲜"],
    emotionalTriggers: ["新鲜", "鲜甜", "安心", "踏实"]
  },
  {
    categoryGroup: "收纳用品",
    commonScenes: ["出门前找东西", "换季整理时", "桌面堆满时", "租房空间里", "衣柜打开时"],
    commonPains: ["东西找不到", "空间越用越乱", "拿取不顺手", "整理后很快又乱"],
    commonDesires: ["一眼找到", "空间更清爽", "拿取更顺手", "整理后更好维持"],
    emotionalTriggers: ["清楚", "松一口气", "少焦虑", "有掌控感"]
  },
  {
    categoryGroup: "美妆个护",
    commonScenes: ["早上出门前", "晚上护理时", "补妆整理时", "通勤包里", "送礼挑选时"],
    commonPains: ["怕不适合自己", "怕质感显廉价", "怕使用步骤麻烦", "怕看不懂差异"],
    commonDesires: ["选择更安心", "状态更体面", "护理更轻松", "送礼不出错"],
    emotionalTriggers: ["精致", "安心", "体面", "少纠结"]
  },
  {
    categoryGroup: "营养补充剂",
    commonScenes: ["看配方标签时", "长期补充时", "出差携带时", "饮食限制下", "复购判断时"],
    commonPains: ["怕成分看不懂", "怕不适合自己", "怕吃法太麻烦", "怕夸大宣传"],
    commonDesires: ["看得懂", "选得快", "补充不断档", "吃得更安心"],
    emotionalTriggers: ["安心", "少纠结", "轻负担", "可持续"]
  },
  {
    categoryGroup: "母婴用品",
    commonScenes: ["夜里照顾孩子时", "外出带娃时", "喂养清洁时", "换洗整理时", "新手爸妈选购时"],
    commonPains: ["怕不够安全", "怕使用太复杂", "怕清洗麻烦", "怕孩子不适应"],
    commonDesires: ["照顾更省力", "使用更安心", "清洁更方便", "外出少狼狈"],
    emotionalTriggers: ["安心", "被照顾", "省力", "踏实"]
  },
  {
    categoryGroup: "数码配件",
    commonScenes: ["通勤路上", "办公桌前", "出差途中", "游戏娱乐时", "设备切换时"],
    commonPains: ["连接不顺", "线材凌乱", "续航焦虑", "兼容怕踩坑"],
    commonDesires: ["连接更稳", "桌面更清爽", "出门少担心", "设备切换更顺"],
    emotionalTriggers: ["高效", "稳定", "少焦虑", "掌控感"]
  },
  {
    categoryGroup: "家居清洁",
    commonScenes: ["下班回家后", "周末大扫除", "饭后清理时", "宠物活动区", "孩子玩耍后"],
    commonPains: ["清理耗时间", "反复擦洗很累", "角落不好处理", "清洁后不够清爽"],
    commonDesires: ["清洁更快", "家里更舒服", "少弯腰少反复", "角落也能顾到"],
    emotionalTriggers: ["轻松", "清爽", "踏实", "舒展"]
  },
  {
    categoryGroup: "服饰配件",
    commonScenes: ["出门搭配前", "通勤上班时", "旅行收纳时", "换季穿搭时", "送礼挑选时"],
    commonPains: ["怕不好搭", "怕不舒服", "怕显廉价", "怕场合不合适"],
    commonDesires: ["搭配更省心", "穿戴更舒服", "出门更体面", "送礼更稳妥"],
    emotionalTriggers: ["体面", "自在", "安心", "有风格"]
  },
  {
    categoryGroup: "通用商品",
    commonScenes: ["日常使用时", "买前对比时", "第一次上手时", "家里摆放时", "送礼挑选时"],
    commonPains: ["怕买错", "怕用不上", "怕细节看不清", "怕和预期不一样"],
    commonDesires: ["判断更快", "上手更轻松", "细节更清楚", "下单少犹豫"],
    emotionalTriggers: ["安心", "少纠结", "轻松", "踏实"]
  }
];

export function inferCategoryGroup(categoryText?: string) {
  const text = categoryText ?? "";

  if (/风扇|电器|家电|电机|加湿|净化|取暖|小家电|冷风|电饭|料理机|吹风/.test(text)) return "小家电";
  if (/锅|杯|碗|盘|刀|厨房|烘焙|餐具|厨具|保鲜|饭盒/.test(text)) return "厨房用品";
  if (
    /生鲜|蔬菜|水果|果蔬|时蔬|净菜|番茄|西红柿|黄瓜|青椒|辣椒|莓|草莓|蓝莓|车厘子|提子|葡萄|柑|橘|橙|苹果|香蕉|梨|桃|西瓜|甜瓜|哈密瓜|芒果|火龙果|鲜肉|牛肉|猪肉|羊肉|鸡肉|鸭肉|海鲜|水产|鲜鱼|鲜虾|活虾|螃蟹|鲜蛋|禽蛋|菌菇|玉米|土豆|红薯|地瓜/.test(
      text
    )
  )
    return "生鲜食品";
  if (/食品|饮品|茶|咖啡|酒|饮料|零食|糕点|坚果|糖果|冲饮|粮油|调味|礼盒|特产/.test(text)) return "食品饮品";
  if (/收纳|置物|衣架|盒|柜|架|整理/.test(text)) return "收纳用品";
  if (/美妆|护肤|彩妆|香水|个护|洗护|精华|面霜|口红/.test(text)) return "美妆个护";
  if (/营养|保健|膳食|维生素|蛋白|益生菌|补充剂|胶囊|片剂/.test(text)) return "营养补充剂";
  if (/母婴|宝宝|婴儿|儿童|奶瓶|纸尿裤|喂养/.test(text)) return "母婴用品";
  if (/数码|手机|电脑|耳机|充电|数据线|键盘|鼠标|支架|配件/.test(text)) return "数码配件";
  if (/清洁|拖把|扫地|除尘|洗衣|宠物清洁|清洗/.test(text)) return "家居清洁";
  if (/服饰|衣服|鞋|包|配饰|帽|袜|穿搭/.test(text)) return "服饰配件";

  return "通用商品";
}

export function getSceneEmotionMap(categoryText?: string) {
  const group = inferCategoryGroup(categoryText);
  return maps.find((item) => item.categoryGroup === group) ?? maps[maps.length - 1];
}

export function pickSceneEmotionContext(input: {
  category?: string;
  scene?: string;
  painPoint?: string;
  desirePoint?: string;
  emotionalTrigger?: string;
}) {
  const map = getSceneEmotionMap(input.category);

  return {
    categoryGroup: map.categoryGroup,
    scene: input.scene || map.commonScenes[0],
    painPoint: input.painPoint || map.commonPains[0],
    desirePoint: input.desirePoint || map.commonDesires[0],
    emotionalTrigger: input.emotionalTrigger || map.emotionalTriggers[0],
    map
  };
}
