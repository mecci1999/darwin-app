/**
 * 获取毫秒数，并且保证返回三位数
 */
export function getMilliseconds() {
  const ms = new Date().getMilliseconds();
  if (ms < 10) {
    return `00${ms}`;
  } else if (ms >= 10 && ms < 100) {
    return `0${ms}`;
  } else {
    return `${ms}`;
  }
}
