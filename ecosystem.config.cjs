// PM2 进程配置 —— 本地与云端通用（免 Docker 部署）
// 用法: pm2 start ecosystem.config.cjs / pm2 stop ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'drama-mill',
      // tsx 直接运行 TS 源码，与 npm start 一致
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      cwd: __dirname + '/backend',
      env: {
        NODE_ENV: 'production',
        PORT: 5679,
        // 统一按北京时间输出日志与相对时间（云主机系统时区由 deploy.sh 自动对齐）
        TZ: 'Asia/Shanghai'
      },
      // 崩溃自动重启与日志；fork 模式单实例（应用内有内存任务状态，不能用 cluster）
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: __dirname + '/logs/app-out.log',
      error_file: __dirname + '/logs/app-error.log',
      merge_logs: true,
      time: true,
      // 单机单实例即可（应用内有内存任务状态）
      instances: 1
    }
  ]
}
