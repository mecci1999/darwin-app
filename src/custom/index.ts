import { queryAllUsers, saveOrUpdateUsers } from 'db/mysql/apis/user';
import Universe from 'node-universe/dist';
import { generateUserId } from 'utils/generateUserId';
import { pinoLoggerOptions } from 'config';
import * as dbConnections from '../db/mysql/index';
import { HttpResponseItem } from '../typings/response';
import xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';

// 微服务名
const appName = 'custom';

const BATCH_SIZE = 100; // 每批次最多发送的请求数量
let index = 0;

const processBatch = async (batch: any[], writepath: string, cookie: string) => {
  const promises = batch.map((item) =>
    fetch(
      'https://aiagent.sf-express.com/api/bypass/app/?Version=2023-08-01&Action=ChatQueryDebug',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Host: 'aiagent.sf-express.com',
          Origin: 'https://aiagent.sf-express.com',
          Referer:
            'https://aiagent.sf-express.com/product/llm/personal/personal-108/application/crqikmntnb5b0m5tms80/arrange?tabKey=arrange',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          'x-csrf-token': 'AM3RvTkX-XsNWPKp6N16AM5OxZp_N6dh7ynw',
          proxy_target: 'llmops-app-server:6789',
          proxy_rewrite_target: '/',
          proxy_rewrite_path_reg: '/api/bypass/app/',
          proxy_proxy_timeout: '300000',
          Cookie: cookie,
          Connection: 'keep-alive',
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          Query: item.intent_list,
          WorkspaceID: 'personal-108',
          AppID: 'crqikmntnb5b0m5tms80',
          Inputs: {},
          AppConfig: {
            ModelID: 'crlaspftnb5b0m5ti290',
            ModelConfig: {
              Temperature: 0.5,
              TopP: 0.5,
              MaxTokens: 512,
              RoundsReserved: 3,
              RagNum: 3,
              Strategy: 'react',
              MaxIterations: 5,
              RagEnabled: false,
            },
            PrePrompt:
              '    # 角色(Role)\n    物流企业客服，负责对用户输入的文本进行意图归类\n\n    # 功能(Skills)\n    ## 功能 1(Skill 1)：对用户文本进行意图分类\n    - 根据给定的几十类意图类型，对用户输入的文本进行准确归类：\n1 查单\n2 催派件\n3 下单\n4 修改信息\n5 退回\n6 开发票\n7 国际业务\n8 咨询\n9 查网点\n10 要求再派\n11 手机号查单\n12 催收件\n13 咨询价格时效\n14 同城寄送\n15 取消下单\n16 快件遗失损坏\n17 拒收\n18 投诉\n20 派前回拨\n21 英文技能\n23 理赔\n27 不愿意使用语音服务\n28 改派送时间\n29 预约下单\n30 托寄物咨询\n31 交易纠纷\n32 更改付款方式\n33 收寄/影响范围咨询\n34 快运业务咨询\n35 冷运业务咨询\n36 媒体投诉\n37 查询快件是否经过特定地点\n38 上门派送\n39 FAQ汇总\n40 售后业务\n41 取消退回\n42 咨询清关\n43 修改注册手机号码\n44 新快件遗失损坏\n46 询问取件时间\n47 询问客服上班时间\n48 春节收不收服务费\n49 招聘\n51 确认通话对象\n52 代收货款\n53 春节服务时效\n54 申请月结\n55 咨询月结\n56 丰巢取件码\n57 咨询中转场电话\n58 询问快递员电话\n59 医药咨询\n60 查单隐址件\n61 网点上班时间\n62 春节资源调节费\n\n    # 限制(Constraint)\n    - 只能依据给定的意图类型进行分类，不得自行创造新的分类\n    -只输出一种最能代表用户意图的分类，不要输出多种\n\n    # 输出(Output)\n    - 输出格式：中文文字\n    - 直接给出归类的意图类型名称\n\n    # 格式(Format)\n    - 无特定格式要求，清晰明了即可\n\n    # 检查(Check)\n    - 确保归类结果符合给定的意图类型范畴\n\n    # 要求(Claim)\n    - 使用中文输出\n    - 归类结果准确无误',
            VariableConfigs: [],
            ToolIDs: [],
            WorkflowIDs: [],
            DatabaseIDs: [],
            KnowledgeIDs: [],
            KnowledgeConfig: {
              RetrievalSearchMethod: 0,
              MatchType: 'force',
              TopK: 3,
              Similarity: 0.5,
            },
            ChatAdvancedConfig: {
              OpeningConfig: {
                OpeningText: '您好！我可以为您的文本数据进行语义识别和打标签归类。',
                OpeningQuestions: [
                  '如何提升文本数据打标签的准确性？',
                  '哪些类型的文本数据比较适合进行打标签归类？',
                  '怎样判断打标签归类的结果是否有效？',
                ],
                OpeningEnabled: true,
              },
              SuggestEnabled: false,
              ReferenceEnabled: false,
              ReviewEnabled: false,
              SuggestPromptConfig: { Prompt: '', Enabled: false },
            },
          },
          QueryExtends: { Files: [] },
          AgentMode: 'Single',
          ConversationID: '01JFESQZCAMYKJP9FMDEJ8325P',
        }),
      },
    )
      .then(async (res) => {
        if (res.ok) {
          const encode = new TextDecoder('utf-8');
          const reader: any = res.body?.getReader();
          let result = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = encode.decode(value, { stream: true });
            const lines = text.split('\n');
            lines.forEach((line) => {
              if (line.includes('"answer":')) {
                const match = line.match(/"answer":\s?"([^"]+)"/);
                if (match && match[1]) {
                  result += match[1];
                }
              }
            });
          }

          const file2 = fs.readFileSync(writepath);
          const workbook2 = xlsx.read(file2, { type: 'buffer', cellDates: true });
          const sheetName2 = workbook2.SheetNames[0];
          const sheet2 = workbook2.Sheets[sheetName2];
          const newData = [[item.call_id, item.intent_list, result]];
          xlsx.utils.sheet_add_aoa(sheet2, newData, { origin: -1 });
          xlsx.writeFile(workbook2, writepath);

          console.log('Processed:', item.call_id);
        }
      })
      .catch((error) => {
        console.error('Error processing:', item.call_id, error);
      }),
  );

  return Promise.all(promises);
};

pinoLoggerOptions(appName).then((pinoOptions) => {
  const star = new Universe.Star({
    namespace: 'darwin-app',
    transporter: {
      type: 'TCP',
      // debug: true,
      // host: 'KAFKA:9093',
    },
    // heartbeatTimeout: 300000,
    // cacher: {
    //   type: "Redis",
    //   clone: true,
    //   options: {
    //     port: 6379, // Redis port
    //     host: "localhost",
    //   },
    // },
    // logger: pinoOptions,
    // metrics: {
    //   enabled: true,
    //   reporter: {
    //     type: "Prometheus",
    //     options: {
    //       port: 3031,
    //     },
    //   },
    // },
  });

  star.createService({
    name: appName,
    methods: {},
    actions: {
      // 网关服务的 dispatch 动作将请求转发到相应的微服务
      'v1.fengyuSendMessage': {
        metadata: {
          auth: false,
        },
        async handler(ctx, route, req, res) {
          // 获取到上传的excel文件
          const readFileName = ctx.params.readfilename;
          const readFileNames1 = ctx.params.readfilenames1;
          const readFileNames2 = ctx.params.readfilenames2;
          const writeFileName = ctx.params.writefilename;
          const writeFileName1 = ctx.params.writefilename1;
          const writeFileName2 = ctx.params.writefilename2;
          const cookie = ctx.params.cookie;

          for (const item of readFileNames1) {
            const filepath = item;
            const writepath = writeFileName1;

            console.log('filepath', filepath, 'writepath', writepath);

            try {
              const file = fs.readFileSync(filepath);
              const workbook = xlsx.read(file, { type: 'buffer', cellDates: true });
              // 获取工作表
              const sheetName = workbook.SheetNames[0];
              const sheet = workbook.Sheets[sheetName];
              // 转换为 JSON 格式
              const data: Array<{ call_id: string; intent_list: string }> =
                xlsx.utils.sheet_to_json(sheet);
              // 重新计算
              index = 0;
              if (!fs.existsSync(writepath)) {
                // 创建excel
                star.logger.info(`创建excel文件：${writepath}`);
                const newExcel = xlsx.utils.book_new();
                const newSheet = xlsx.utils.aoa_to_sheet([['call_id', 'intent_list', 'answer']]);
                xlsx.utils.book_append_sheet(newExcel, newSheet, 'Sheet1');
                xlsx.writeFile(newExcel, writepath);
              }

              console.log(data.length);

              while (index < data.length) {
                const batch = data.slice(index, index + BATCH_SIZE);
                await processBatch(batch, writepath, cookie);
                index += BATCH_SIZE;
                star.logger.info(`已完成${index}条数据`);
              }
            } catch (error) {
              console.error(error);
              return {
                status: 400,
                data: {
                  message: 'error',
                  content: { error },
                },
              };
            }
          }

          // const filepath = readFileName;
          // const writepath = writeFileName;

          // console.log('filepath', filepath, 'writepath', writepath);

          // try {
          //   const file = fs.readFileSync(filepath);
          //   const workbook = xlsx.read(file, { type: 'buffer', cellDates: true });
          //   // 获取工作表
          //   const sheetName = workbook.SheetNames[0];
          //   const sheet = workbook.Sheets[sheetName];
          //   // 转换为 JSON 格式
          //   const data: Array<{ call_id: string; intent_list: string }> =
          //     xlsx.utils.sheet_to_json(sheet);

          //   if (!fs.existsSync(writepath)) {
          //     // 创建excel
          //     star.logger.info(`创建excel文件：${writepath}`);
          //     const newExcel = xlsx.utils.book_new();
          //     const newSheet = xlsx.utils.aoa_to_sheet([['call_id', 'intent_list', 'answer']]);
          //     xlsx.utils.book_append_sheet(newExcel, newSheet, 'Sheet1');
          //     xlsx.writeFile(newExcel, writepath);
          //   }

          //   while (index < data.length) {
          //     const batch = data.slice(index, index + BATCH_SIZE);
          //     await processBatch(batch, writepath, cookie);
          //     index += BATCH_SIZE;
          //     star.logger.info(`已完成${index}条数据`);
          //   }

          // // 循环处理数据
          // for (const item of data) {
          // fetch(
          //   'https://aiagent.sf-express.com/api/bypass/app/?Version=2023-08-01&Action=ChatQueryDebug',
          //   {
          //     method: 'POST',
          //     headers: {
          //       Accept: 'application/json, text/event-stream',
          //       'Accept-Encoding': 'gzip, deflate, br, zstd',
          //       'Accept-Language': 'zh-CN,zh;q=0.9',
          //       Host: 'aiagent.sf-express.com',
          //       Origin: 'https://aiagent.sf-express.com',
          //       Referer:
          //         'https://aiagent.sf-express.com/product/llm/personal/personal-108/application/crqikmntnb5b0m5tms80/arrange?tabKey=arrange',
          //       'Sec-Fetch-Dest': 'empty',
          //       'Sec-Fetch-Mode': 'cors',
          //       'Sec-Fetch-Site': 'same-origin',
          //       'x-csrf-token': 'AM3RvTkX-XsNWPKp6N16AM5OxZp_N6dh7ynw',
          //       proxy_target: 'llmops-app-server:6789',
          //       proxy_rewrite_target: '/',
          //       proxy_rewrite_path_reg: '/api/bypass/app/',
          //       proxy_proxy_timeout: '300000',
          //       Cookie:
          //         'sensorsdata2015session=%7B%7D; a_authorization_login=01420829; a_authorization_prd_login=01420829; csrf=t7wisKiCcihNzXeeTWRS2DKbMwJjEzsz; a_authorization_prd=ee55a76c-8978-4ba4-9317-750a0e8192ea/f4161a11-5f79-472e-a094-23cd9928a565/6E8BDA8024CCDEDA2338F205C99B6F3F; validate_key_auth_prd=f8a75ff89cb44621b5d4d6164d095a48; a_authorization=df696b32-ab27-4150-8853-22bfbf4ed98b/a58746a4-be7c-45ae-97ce-2e5a2d555201/CFE50543D17C5F726418A3461D54DD44; validate_key_auth=b2fac192b74e4e1b851284695e355ebe; _csrf=ZSGQHCJ_6ggtf8q20XWW9Bcq; tenant=s%3A5a9PB_XQk7C-nFwZoph1jXucIFKiYd0u.4P3zE9UiCb7fDOiXxTRo1dXMSgR4oAOieIDC2h%2BQvtA; sensorsdata2015jssdkcross=%7B%22distinct_id%22%3A%2201420829%22%2C%22first_id%22%3A%2201420829%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E7%9B%B4%E6%8E%A5%E6%B5%81%E9%87%8F%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC_%E7%9B%B4%E6%8E%A5%E6%89%93%E5%BC%80%22%2C%22%24latest_referrer%22%3A%22%22%7D%2C%22identities%22%3A%22eyIkaWRlbnRpdHlfY29va2llX2lkIjoiMTkzNTM5OGZhOTcyMy0wYTBjNmU2ODE1ZTlhYTgtMWU1MjU2MzYtMTI5NjAwMC0xOTM1Mzk4ZmE5ODlmYSIsIiRpZGVudGl0eV9sb2dpbl9pZCI6IjAxNDIwODI5IiwiJGlkZW50aXR5X2Fub255bW91c19pZCI6IjAxNDIwODI5In0%3D%22%2C%22history_login_id%22%3A%7B%22name%22%3A%22%24identity_login_id%22%2C%22value%22%3A%2201420829%22%7D%2C%22%24device_id%22%3A%221935398fa9723-0a0c6e6815e9aa8-1e525636-1296000-1935398fa989fa%22%7D; x-csrf-token=AM3RvTkX-XsNWPKp6N16AM5OxZp_N6dh7ynw',
          //       'Content-Type': 'application/json',
          //       Connection: 'keep-alive',
          //     },
          //     body: JSON.stringify({
          //       Query: item.intent_list,
          //       WorkspaceID: 'personal-108',
          //       AppID: 'crqikmntnb5b0m5tms80',
          //       Inputs: {},
          //       AppConfig: {
          //         ModelID: 'crlaspftnb5b0m5ti290',
          //         ModelConfig: {
          //           Temperature: 0.5,
          //           TopP: 0.5,
          //           MaxTokens: 512,
          //           RoundsReserved: 3,
          //           RagNum: 3,
          //           Strategy: 'react',
          //           MaxIterations: 5,
          //           RagEnabled: false,
          //         },
          //         PrePrompt:
          //           '    # 角色(Role)\n    物流企业客服，负责对用户输入的文本进行意图归类\n\n    # 功能(Skills)\n    ## 功能 1(Skill 1)：对用户文本进行意图分类\n    - 根据给定的几十类意图类型，对用户输入的文本进行准确归类：\n1 查单\n2 催派件\n3 下单\n4 修改信息\n5 退回\n6 开发票\n7 国际业务\n8 咨询\n9 查网点\n10 要求再派\n11 手机号查单\n12 催收件\n13 咨询价格时效\n14 同城寄送\n15 取消下单\n16 快件遗失损坏\n17 拒收\n18 敏感词转人工\n19 投诉转人工\n20 派前回拨\n21 英文技能\n22 主动转人工\n23 理赔\n24 首层主动转人工\n25 老年人转人工\n26 保价转人工\n27 不愿意使用语音服务\n28 改派送时间\n29 预约下单\n29 预约下单\n30 托寄物咨询\n30 托寄物咨询\n31 交易纠纷\n31 交易纠纷\n32 更改付款方式\n33 收寄/影响范围咨询\n34 快运业务咨询\n35 冷运业务咨询\n36 媒体投诉\n37 查询快件是否经过特定地点\n38 上门派送\n39 FAQ汇总\n40 售后业务\n41 取消退回\n42 咨询清关\n43 修改注册手机号码\n44 新快件遗失损坏\n45 在吗\n46 询问取件时间\n47 询问客服上班时间\n48 春节收不收服务费\n49 招聘\n50 是顺丰吗\n51 确认通话对象\n52 代收货款\n53 春节服务时效\n54 申请月结\n55 咨询月结\n56 丰巢取件码\n57 咨询中转场电话\n58 询问快递员电话\n59 医药咨询\n60 查单隐址件\n61 网点上班时间\n62 春节资源调节费\n\n    # 限制(Constraint)\n    - 只能依据给定的意图类型进行分类，不得自行创造新的分类\n    -只输出一种最能代表用户意图的分类，不要输出多种\n\n    # 输出(Output)\n    - 输出格式：中文文字\n    - 直接给出归类的意图类型名称\n\n    # 格式(Format)\n    - 无特定格式要求，清晰明了即可\n\n    # 检查(Check)\n    - 确保归类结果符合给定的意图类型范畴\n\n    # 要求(Claim)\n    - 使用中文输出\n    - 归类结果准确无误',
          //         VariableConfigs: [],
          //         ToolIDs: [],
          //         WorkflowIDs: [],
          //         DatabaseIDs: [],
          //         KnowledgeIDs: [],
          //         KnowledgeConfig: {
          //           RetrievalSearchMethod: 0,
          //           MatchType: 'force',
          //           TopK: 3,
          //           Similarity: 0.5,
          //         },
          //         ChatAdvancedConfig: {
          //           OpeningConfig: {
          //             OpeningText: '您好！我可以为您的文本数据进行语义识别和打标签归类。',
          //             OpeningQuestions: [
          //               '如何提升文本数据打标签的准确性？',
          //               '哪些类型的文本数据比较适合进行打标签归类？',
          //               '怎样判断打标签归类的结果是否有效？',
          //             ],
          //             OpeningEnabled: true,
          //           },
          //           SuggestEnabled: false,
          //           ReferenceEnabled: false,
          //           ReviewEnabled: false,
          //           SuggestPromptConfig: {
          //             Prompt: '',
          //             Enabled: false,
          //           },
          //         },
          //       },
          //       QueryExtends: {
          //         Files: [],
          //       },
          //       AgentMode: 'Single',
          //       ConversationID: '01J8PV4VB0JAS0G6WJ8VYHDMGZ',
          //     }),
          //   },
          // );
          // .then(async (res) => {
          //   // 判断是否正常返回
          // if (res.ok) {
          //   const encode = new TextDecoder('utf-8');
          //   const reader: any = res.body?.getReader();
          //   let result = '';
          //   while (true) {
          //     const { done, value } = await reader.read();
          //     if (done) {
          //       break;
          //     }

          //     const text = encode.decode(value, { stream: true });
          //     const lines = text.split('\n');
          //     lines.forEach((line) => {
          //       if (line.includes('"answer":')) {
          //         const match = line.match(/"answer":\s?"([^"]+)"/);
          //         if (match && match[1]) {
          //           result += match[1]; // 拼接 answer 字段
          //         }
          //       }
          //     });
          //   }

          //     // 将数据写入到某个excel文件里
          //     const file2 = fs.readFileSync(writepath);
          //     const workbook2 = xlsx.read(file2, { type: 'buffer', cellDates: true });

          //     // 获取第一个工作表
          //     const sheetName2 = workbook2.SheetNames[0];
          //     const sheet2 = workbook2.Sheets[sheetName2];

          //     const newData = [[item.call_id, item.intent_list, result]];

          //     xlsx.utils.sheet_add_aoa(sheet2, newData, { origin: -1 });

          //     xlsx.writeFile(workbook2, writepath);

          //     console.log('result:', result);
          //   }
          // })
          //     .catch((error) => {
          //       return {
          //         status: 400,
          //         data: {
          //           message: 'error',
          //           content: { error },
          //         },
          //       };
          //     });
          //   ++index;
          //   console.log(`已完成${index}条数据`);
          // }
        },
      },
    },
    async created() {},
  });

  // 启动网关微服务
  star.start().then(() => {
    console.log(`微服务 ${appName.toUpperCase()} 启动成功`);
  });
});
