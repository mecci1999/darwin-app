import fs from "fs";
import { spawn } from "child_process";

/**
 * 用来在控制台展示pino生成的文件日志
 */
function showPinoLogFile() {
  console.log(process.argv);
  // 日志模块名
  let moduleName = "";
  // 日志日期
  let date = "";
  // 找到要展示的日志名
  const moduleIndex = process.argv.indexOf("--module");
  if (moduleIndex !== -1) {
    moduleName = process.argv[moduleIndex + 1];
  }
  const dateIndex = process.argv.indexOf("--date");
  if (dateIndex !== -1) {
    date = process.argv[dateIndex + 1];
  }

  const path = `./logs/${moduleName}/${date}.log`;

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

showPinoLogFile();
