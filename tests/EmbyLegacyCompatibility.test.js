import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadHeroBackdropResolver() {
    const source = readFileSync(new URL('../src/ui/HeroCarousel.js', import.meta.url), 'utf8');
    const start = source.indexOf('export function resolveHeroBackdrop');
    const end = source.indexOf('class HeroCarousel', start);
    return vm.runInNewContext(
        `${source.slice(start, end).replace('export function', 'function')}\nresolveHeroBackdrop;`
    );
}

function loadMediaHelper(serverInfo = { ServerName: 'Emby', Version: '4.7.14.0' }) {
    const source = readFileSync(new URL('../src/player/core/MediaHelper.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '')
        .replace('export const MediaHelper', 'const MediaHelper')
        .replace(/export default MediaHelper;?/, '')
        .concat('\nMediaHelper;');

    return vm.runInNewContext(source, {
        storage: { getItem() {}, setItem() {} },
        platformInfo: { isTizen: true },
        state: { get: (key) => (key === 'server:info' ? serverInfo : null) },
        URLSearchParams,
        Set
    });
}

const resolveHeroBackdrop = loadHeroBackdropResolver();

test('hero uses standard BackdropImageTags and preserves plugin fallback', () => {
    const resolved = resolveHeroBackdrop({
        Id: 'movie',
        BackdropImageTags: ['emby-tag'],
        ImageTags: { Backdrop: 'plugin-tag' }
    });
    assert.equal(resolved.itemId, 'movie');
    assert.equal(resolved.tag, 'emby-tag');

    const inherited = resolveHeroBackdrop({
        Id: 'episode',
        SeriesId: 'series',
        ParentBackdropItemId: 'parent',
        ParentBackdropImageTags: ['parent-tag']
    });
    assert.equal(inherited.itemId, 'parent');
    assert.equal(inherited.tag, 'parent-tag');

    const pluginFallback = resolveHeroBackdrop({ Id: 'movie', ImageTags: { Backdrop: 'plugin-tag' } });
    assert.equal(pluginFallback.itemId, 'movie');
    assert.equal(pluginFallback.tag, 'plugin-tag');

    const noTag = resolveHeroBackdrop({ Id: 'movie-no-tag' });
    assert.equal(noTag.itemId, 'movie-no-tag');
    assert.equal(noTag.tag, undefined);
});

test('Emby 4.7 direct playback uses DirectStreamUrl (e.g. original.mkv)', () => {
    const helper = loadMediaHelper({ ServerName: 'Emby', Version: '4.7.14.0' });
    const ticks = 9870000000;
    const result = helper.buildStreamUrl({
        serverUrl: 'http://emby:8096',
        itemId: 'movie',
        mediaSource: {
            Id: 'source',
            Container: 'mkv',
            SupportsDirectPlay: true,
            SupportsDirectStream: true,
            DirectStreamUrl: '/videos/movie/original.mkv?DeviceId=tv&MediaSourceId=source',
            MediaStreams: []
        },
        startPositionTicks: ticks,
        playSessionId: 'session',
        authToken: 'token'
    });

    assert.match(result.url, /^http:\/\/emby:8096\/videos\/movie\/original\.mkv\?/);
    assert.match(result.url, /api_key=token/);
    assert.match(result.url, /PlaySessionId=session/);
    assert.doesNotMatch(result.url, /\/stream\.mkv/);
    assert.equal(result.playerStartPositionTicks, ticks);
    assert.equal(result.transcodingOffsetTicks, 0);
});

test('modern Emby (4.10) keeps the standard direct-play stream.mkv URL path', () => {
    const helper = loadMediaHelper({ ServerName: 'Emby', Version: '4.10.0.40' });
    const ticks = 9870000000;
    const result = helper.buildStreamUrl({
        serverUrl: 'http://emby:8096',
        itemId: 'movie',
        mediaSource: {
            Id: 'source',
            Container: 'mkv',
            SupportsDirectPlay: true,
            SupportsDirectStream: true,
            DirectStreamUrl: '/videos/movie/original.mkv?DeviceId=tv&MediaSourceId=source',
            MediaStreams: []
        },
        startPositionTicks: ticks,
        playSessionId: 'session',
        authToken: 'token'
    });

    assert.match(result.url, /^http:\/\/emby:8096\/Videos\/movie\/stream\.mkv\?Static=true/);
    assert.doesNotMatch(result.url, /original\.mkv/);
    assert.equal(result.playerStartPositionTicks, ticks);
    assert.equal(result.transcodingOffsetTicks, 0);
});

test('Jellyfin keeps the standard direct-play stream.mkv URL path', () => {
    const helper = loadMediaHelper({ ServerName: 'Jellyfin', ProductName: 'Jellyfin Server', Version: '10.9.11' });
    const ticks = 9870000000;
    const result = helper.buildStreamUrl({
        serverUrl: 'http://jellyfin:8096',
        itemId: 'movie',
        mediaSource: {
            Id: 'source',
            Container: 'mkv',
            SupportsDirectPlay: true,
            SupportsDirectStream: true,
            DirectStreamUrl: '/videos/movie/original.mkv?DeviceId=tv&MediaSourceId=source',
            MediaStreams: []
        },
        startPositionTicks: ticks,
        playSessionId: 'session',
        authToken: 'token'
    });

    assert.match(result.url, /^http:\/\/jellyfin:8096\/Videos\/movie\/stream\.mkv\?Static=true/);
    assert.doesNotMatch(result.url, /original\.mkv/);
    assert.equal(result.playerStartPositionTicks, ticks);
    assert.equal(result.transcodingOffsetTicks, 0);
});

test('hero fallback uses the Emby ImageTypes backdrop filter only for Emby 4.7', () => {
    const source = readFileSync(new URL('../src/pages/HomePage.js', import.meta.url), 'utf8');
    assert.match(source, /const useLegacyEmbyBackdropQuery = api\.isEmby47\(\)/);
    assert.match(source, /Filters: useLegacyEmbyBackdropQuery \? 'IsUnplayed' : 'HasBackdrop,IsUnplayed'/);
});

test('compatibility detection is strictly limited to Emby 4.7.x', () => {
    const source = readFileSync(new URL('../src/api/ApiClient.js', import.meta.url), 'utf8');
    assert.match(source, /isEmby47\(\) \{/);
    assert.match(source, /return major === 4 && minor === 7/);
});
