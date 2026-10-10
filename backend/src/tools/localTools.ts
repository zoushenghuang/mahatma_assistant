import type { OpenAITool } from '../types';

/**
 * 本地自定义工具（原生 Function Calling 演示）
 *
 * 两个部分：
 * - localTools      —— 工具"描述"：交给模型理解"有什么工具、参数是什么"
 * - localExecutors  —— 工具"实现"：模型只负责决定"调不调"，真正执行的是这里的函数
 */

// 关键节点：Function Calling —— 工具定义（OpenAI 格式）
export const localTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'getWeather',
      description:
        '查询任意城市的当前天气、温度与穿衣建议。当用户问"某城市今天冷不冷 / 穿什么衣服 / 天气如何"时调用',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名，例如：长沙、北京、广州' },
        },
        required: ['city'],
      },
    },
  },
];

// 关键节点：Function Calling —— 工具实现（纯本地代码，不依赖任何外部服务）
export const localExecutors: Record<string, (args: any) => any> = {
  // getWeather：内置少量城市数据，模拟真实天气查询（演示用）
  getWeather: ({ city }) => {
    if (!city) {
      return { error: '缺少参数：city（城市名）' };
    }

    // 演示用的内置数据
    const weatherMap: Record<string, { weather: string; temperature: number; advice: string }> = {
      长沙: { weather: '阴转小雨', temperature: 6, advice: '今天很冷，建议穿棉袄 / 羽绒服' },
      北京: { weather: '晴', temperature: 3, advice: '气温低且有风，建议穿棉袄并戴围巾' },
      上海: { weather: '多云转晴', temperature: 8, advice: '偏冷，建议穿呢子大衣' },
      广州: { weather: '多云', temperature: 20, advice: '体感舒适，穿薄外套即可' },
      深圳: { weather: '晴', temperature: 22, advice: '温暖舒适，短袖加薄外套' },
    };

    const hit = weatherMap[city];
    const data = hit ?? {
      weather: '晴',
      temperature: Math.round(Math.random() * 20),
      advice: '模拟数据，具体请以当地气象台为准',
    };

    const result = {
      city,
      weather: data.weather,
      temperature: `${data.temperature}°C`,
      advice: data.advice,
      source: '本地内置模拟数据',
    };

    // 关键节点：Function Calling —— 工具执行结果
    console.log(`[本地工具] getWeather 执行完成:`, JSON.stringify(result));
    return result;
  },
};
