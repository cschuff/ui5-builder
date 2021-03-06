const log = require("@ui5/logger").getLogger("builder:tasks:bundlers:generateManifestBundle");
const manifestBundler = require("../../processors/bundlers/manifestBundler");
const DESCRIPTOR = "manifest.json";
const PROPERTIES_EXT = ".properties";
const BUNDLE_NAME = "manifest-bundle.zip";

/**
 * Task for manifestBundler.
 *
 * @public
 * @alias module:@ui5/builder.tasks.generateManifestBundle
 * @param {Object} parameters Parameters
 * @param {module:@ui5/fs.DuplexCollection} parameters.workspace DuplexCollection to read and write files
 * @param {Object} parameters.options Options
 * @param {string} parameters.options.projectName Project name
 * @param {string} parameters.options.namespace Namespace of the application/library
 * @returns {Promise<undefined>} Promise resolving with <code>undefined</code> once data has been written
 */
module.exports = function({workspace, options}) {
	return workspace.byGlob(`/**/{${DESCRIPTOR},*${PROPERTIES_EXT}}`)
		.then((allResources) => {
			if (allResources.length > 0) {
				return manifestBundler({
					resources: allResources,
					options: {
						descriptor: DESCRIPTOR,
						propertiesExtension: PROPERTIES_EXT,
						bundleName: BUNDLE_NAME,
						namespace: options.namespace
					}
				}).then((processedResources) => {
					return Promise.all(processedResources.map((resource) => {
						return workspace.write(resource);
					}));
				});
			} else {
				log.verbose(`Could not find a "${DESCRIPTOR}" file for project ${options.projectName}, creation of "${BUNDLE_NAME}" is skipped!`);
			}
		});
};
