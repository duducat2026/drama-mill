/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
 * Copyright (C) 2026 Drama Mill <52859273@qq.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Hono } from 'hono'
import { adminGuard } from '../../middleware/auth.js'
import usersRoutes from './users.js'
import assetsRoutes from './assets.js'
import aiConfigsRoutes from './ai-configs.js'
import auditRoutes from './audit.js'
import dramasRoutes from './dramas.js'
import storyboardsRoutes from './storyboards.js'
import videosRoutes from './videos.js'
import mergesRoutes from './merges.js'
import panelRoutes from './panel.js'
import costsRoutes from './costs.js'
import modelPricesRoutes from './model-prices.js'
import modelCatalogRoutes from './model-catalog.js'
import storageRoutes from './storage.js'
import monitorRoutes from './monitor.js'
import cloudQueueRoutes from './cloud-queue.js'
import novelsRoutes from './novels.js'
import splitTemplatesRoutes from './split-templates.js'

const app = new Hono()
app.use('*', adminGuard)
app.route('/', usersRoutes)
app.route('/', assetsRoutes)
app.route('/', aiConfigsRoutes)
app.route('/', auditRoutes)
app.route('/', dramasRoutes)
app.route('/', storyboardsRoutes)
app.route('/', videosRoutes)
app.route('/', mergesRoutes)
app.route('/', panelRoutes)
app.route('/', costsRoutes)
app.route('/', modelPricesRoutes)
app.route('/', modelCatalogRoutes)
app.route('/', storageRoutes)
app.route('/', monitorRoutes)
app.route('/', cloudQueueRoutes)
app.route('/', novelsRoutes)
app.route('/', splitTemplatesRoutes)

export default app
