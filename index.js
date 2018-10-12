const R = require ( 'ramda' );
const H = require ( 'highland' );
const { Url: URL } = require ( 'url' );
const request = require ( 'request' );
const objectWalker = require ( 'highland-object-walker' );

const pools = {};

const makeRequest = ( replaceErrorsWith, uri ) => {
    const url = new URL ( uri );
    if ( ! pools[url.origin] ) { pools[url.origin] = { maxSockets: 100 }; }
    const pool = pools[url.origin];

    return H.wrapCallback ( request )( {
        uri,
        json: true,
        pool
    } )
        .errors ( ( error, push ) => {
            if ( replaceErrorsWith === undefined ) {
                return push ( error );
            }
            return push ( null, R.type ( replaceErrorsWith ) === 'Function' ? replaceErrorsWith ( uri ) : replaceErrorsWith );
        } )
        .flatMap ( H.wrapCallback ( ( response = {}, callback ) => {
            if ( response.statusCode !== 200 ) {
                if ( replaceErrorsWith === undefined ) {
                    return callback ( {
                        code: response.statusCode,
                        message: response.body
                    } );
                }

                return callback ( null, R.type ( replaceErrorsWith ) === 'Function' ? replaceErrorsWith ( uri ) : replaceErrorsWith );
            }

            return callback ( null, response.body );
        } ) );
};

const hydrator = R.curry ( ( { rules, replaceErrorsWith }, O, callback ) => {
    return objectWalker ( {
        String: O => {
            if ( R.reduce ( ( match, rule ) => {
                return match && O.match ( rule );
            }, true, rules || [ /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/ ] ) ) {
                return makeRequest ( replaceErrorsWith, O );
            }

            return H ( [ O ] );
        }
    }, O ).toCallback ( callback );
} );

module.exports = hydrator;

if ( ! module.parent ) {
    const assert = require ( 'assert' );
    const deepEquals = require ( 'deep-equals' );
    const testObject = {
        a: 12345,
        b: 'hallo',
        c: {
            url1: 'https://jsonplaceholder.typicode.com/posts/1',
            url2: 'https://jsonplaceholder.typicode.com/posts/2',
            url3: 'https://jsonplaceholder.typicode.com/posts/10'
        },
        d: [
            'https://jsonplaceholder.typicode.com/posts/3',
            'https://jsonplaceholder.typicode.com/posts/4',
            'https://jsonplaceholder.typicode.com/posts/11'
        ]
    };

    const doTests = R.curry ( ( type, hydratedPaths, testObject, replaceErrorsWith, error, response ) => {
        console.log ( `Testing ${type} ...` );
        assert ( error === null, `error is ${error}` );

        const syncInput = R.reduce ( ( syncInput, path ) => R.dissocPath ( path, syncInput ), testObject, hydratedPaths );
        const syncResponse = R.reduce ( ( syncResponse, path ) => R.dissocPath ( path, syncResponse ), response, hydratedPaths );
        const asyncInput = R.reduce ( ( asyncInput, path ) => R.assocPath ( path, R.path ( path, testObject ), asyncInput ), {}, hydratedPaths );
        const asyncResponse = R.reduce ( ( asyncResponse, path ) => R.assocPath ( path, R.path ( path, response ), asyncResponse ), {}, hydratedPaths );

        return objectWalker ( {
            String: O => makeRequest ( replaceErrorsWith, O )
        }, asyncInput ).toCallback ( ( error, hydratedInput ) => {
            assert ( error === null, `error is ${error}` );
            assert ( deepEquals ( syncResponse, syncInput ), `Sync inputs don't match up with sync outputs:\n${JSON.stringify(syncInput,null,4)}\nvs\n${JSON.stringify(syncResponse,null,4)}` );
            assert ( deepEquals ( asyncResponse, hydratedInput ), `Async & hydrated inputs don't match up with async outputs:\n${JSON.stringify(hydratedInput,null,4)}\nvs\n${JSON.stringify(asyncResponse,null,4)}` );

            console.log ( `... ${type} success` );
        } );
    } );

    hydrator ( {}, testObject, doTests ( 'no rules', [
        [ 'c', 'url1' ],
        [ 'c', 'url2' ],
        [ 'c', 'url3' ],
        [ 'd', 2 ],
        [ 'd', 1 ],
        [ 'd', 0 ]
    ], testObject, undefined ) );

    hydrator ( {
        rules: [
            /https\:\/\/jsonplaceholder\.typicode\.com\/posts\/./
        ]
    }, testObject, doTests ( 'inclusive rules', [
        [ 'c', 'url1' ],
        [ 'c', 'url2' ],
        [ 'c', 'url3' ],
        [ 'd', 2 ],
        [ 'd', 1 ],
        [ 'd', 0 ]
    ], testObject, undefined ) );

    hydrator ( {
        rules: [
            /^https\:\/\/jsonplaceholder\.typicode\.com\/posts\/.$/
        ]
    }, testObject, doTests ( 'exclusive rules', [
        [ 'c', 'url1' ],
        [ 'c', 'url2' ],
        [ 'd', 1 ],
        [ 'd', 0 ]
    ], testObject, undefined ) );

    const testObject2 = {
        a: 12345,
        b: 'hallo',
        c: {
            url1: 'https://jsonplaceholder.typicode.com/hallo',
            url2: 'https://jsonplaceholder.typicode.com/posts/2',
            url3: 'https://jsonplaceholder.typicode.com/posts/10'
        },
        d: [
            'https://jsonplaceholder.typicode.com/posts/3',
            'https://jsonplaceholder.typicode.com/posts/4',
            'https://jsonplaceholder.typicode.com/posts/11'
        ]
    };

    hydrator ( {}, testObject2, ( error, response ) => {
        console.log ( 'Testing errors ...' );
        assert ( response === undefined, `response is:\n${JSON.stringify(response,null,4)}` );
        assert ( error.code === 404, `error code is ${error.code}` );
        console.log ( '... errors success' );
    } );

    hydrator ( { replaceErrorsWith: null }, testObject2, doTests ( 'error replacement', [
        [ 'c', 'url1' ],
        [ 'c', 'url2' ],
        [ 'c', 'url3' ],
        [ 'd', 2 ],
        [ 'd', 1 ],
        [ 'd', 0 ]
    ], testObject2, null ) );
}
