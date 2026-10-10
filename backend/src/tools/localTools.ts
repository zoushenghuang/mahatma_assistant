import type { OpenAITool, ToolContext } from '../types';
import { getWeatherReport, type GeoLocation } from '../weather';

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
        '查询某个位置的实时天气、温度、多天预报与穿衣建议。' +
        '当用户问"今天/明天天气怎么样""冷不冷""要不要带伞""穿什么衣服"时调用。' +
        '若用户没有指明城市，说明问的是"当前位置"的天气，此时不要填 city，直接调用本工具，' +
        '系统会自动使用用户当前所在位置（如"长沙岳麓区"）。',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description:
              '城市名，例如：长沙、北京、广州。仅当用户明确指定了城市时才填写；问当前位置天气时请留空。',
          },
        },
        required: [],
      },
    },
  },
];

// 关键节点：Function Calling —— 工具实现（真实天气查询，支持用户当前位置）
export const localExecutors: Record<string, (args: any, ctx: ToolContext) => unknown> = {
  // getWeather：真实天气。优先用户指定城市；未指定则用用户当前位置坐标
  getWeather: async ({ city }: { city?: string }, ctx: ToolContext) => {
    // 用户当前位置：由前端浏览器定位上报，经 ToolContext 注入
    const location: GeoLocation | undefined = ctx?.location
      ? { latitude: ctx.location.latitude, longitude: ctx.location.longitude }
      : undefined;

    const hasCity = typeof city === 'string' && city.trim().length > 0;

    // 既没有城市、也没有当前位置：明确告知模型原因，让它引导用户
    if (!hasCity && !location) {
      return {
        error: 'no_location',
        message:
          '用户没有指定城市，也没有获取到当前位置信息。请让用户直接说出想查询的城市名，或允许浏览器获取定位后重试。',
      };
    }

    const report = await getWeatherReport({
      city: hasCity ? city.trim() : undefined,
      location,
    });

    // 关键节点：Function Calling —— 工具执行结果
    console.log(
      `[本地工具] getWeather 执行完成: ${report.place.displayName} · ${report.current.text} ${report.current.temperature}°C（数据源：${report.source}）`,
    );
    return report;
  },
};
