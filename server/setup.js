/*
 * Setup script to ensure libs are built before starting server
 */

import {buildLibs} from '../dev/bin/build-libs.js';

try {
    console.log('Building libs...');
    await buildLibs();
    console.log('Libs built successfully');
} catch (error) {
    console.error('Failed to build libs:', error);
    process.exit(1);
}


