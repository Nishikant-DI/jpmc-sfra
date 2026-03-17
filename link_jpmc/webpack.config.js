'use strict';

var path = require('path');
var MiniCssExtractPlugin = require('mini-css-extract-plugin');

// sgmf-scripts auto-discovers int_jpmc_sfra JS via packageName
var jsFiles = require('sgmf-scripts').createJsPath();

// Paths
var bmStaticRel = path.relative(
    path.resolve('./cartridges/int_jpmc_sfra/cartridge/static'),
    path.resolve('./cartridges/bm_jpmc/cartridge/static')
);

// Add bm_jpmc JS — use relative path prefix so webpack writes to the correct cartridge static dir
// Use path.posix.join to ensure forward-slash separators in entry keys regardless of OS
jsFiles[path.posix.join(bmStaticRel.split(path.sep).join('/'), 'default/js/cscOrder')] = path.resolve(
    './cartridges/bm_jpmc/cartridge/client/default/js/cscOrder.js'
);

module.exports = [
    // ── JS (all cartridges) ──
    // sgmf-scripts --compile js picks this config by name
    {
        mode: 'production',
        name: 'js',
        entry: jsFiles,
        output: {
            path: path.resolve('./cartridges/int_jpmc_sfra/cartridge/static'),
            filename: '[name].js'
        },
        module: {
            rules: [
                {
                    test: /\.js$/,
                    exclude: /node_modules/,
                    use: {
                        loader: 'babel-loader',
                        options: {
                            presets: ['@babel/env'],
                            cacheDirectory: true
                        }
                    }
                }
            ]
        },
        resolve: {
            alias: {
                base: path.resolve(__dirname, '../storefront-reference-architecture-master/cartridges/app_storefront_base/cartridge/client/default/js')
            }
        }
    },
    // ── CSS / SCSS (all cartridges) ──
    // sgmf-scripts --compile css picks this config by name 'scss'
    {
        mode: 'production',
        name: 'scss',
        entry: {
            'default/css/cscOrder': path.resolve(
                './cartridges/bm_jpmc/cartridge/client/default/scss/cscOrder.scss'
            )
        },
        output: {
            path: path.resolve('./cartridges/bm_jpmc/cartridge/static')
        },
        plugins: [
            new MiniCssExtractPlugin({
                filename: '[name].css'
            })
        ],
        module: {
            rules: [
                {
                    test: /\.scss$/,
                    use: [
                        MiniCssExtractPlugin.loader,
                        { loader: 'css-loader', options: { url: false } },
                        { loader: 'sass-loader', options: { api: 'modern' } }
                    ]
                }
            ]
        }
    }
];
