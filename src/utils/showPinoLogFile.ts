import fs from "fs";
import { spawn } from "child_process";

/**
 * 用来在控制台展示pino生成的文件日志
 */
function showPinoLogFile(path: string) {
  // 根据路径获取到对应的日志文件
  if (!path) return;

  // 文件不存在
  if (!fs.existsSync(path)) return;

  // 执行命令脚本
  const child1 = spawn("cat", [path]);
  const child2 = spawn("pino-pretty");

  child1.stdout.pipe(child2.stdin);

  child2.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });

  child2.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  child2.on("close", (code) => {
    console.log(`child process exited with code ${code}`);
  });
}

showPinoLogFile("./logs/gateway/2024_03_22.log");
