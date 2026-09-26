const mods: any = await import('./src/services/generation.js')
console.log('exports:', Object.keys(mods).length)
const stats = mods.getTaskQueueStats()
console.log('queue ok:', stats.running === 0 && stats.max > 0, '| gateway fn:', typeof mods.getGatewayRateStats === 'function', '| retry:', typeof mods.retryTask === 'function', '| resume:', typeof mods.resumeInterruptedTasks === 'function')
