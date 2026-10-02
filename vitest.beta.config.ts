import { defineConfig, mergeConfig } from 'vitest/config'
import config from './vitest.config'
export default mergeConfig(config, defineConfig({test:{server:{deps:{inline:['next-intl']}}}}))
