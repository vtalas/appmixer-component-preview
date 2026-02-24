/**
 * Appmixer Store API
 */

/**
 * Fetch store records.
 * @param {AxiosInstance} client
 * @param {string} storeId
 * @param {Object} [options] - { offset, limit, sort }
 * @returns {Promise<Array>}
 */
export const fetchStoreRecords = async (client, storeId, options = {}) => {
    if (!storeId) return [];
    const { data } = await client.get('/store', {
        params: {
            storeId,
            offset: options.offset ?? 0,
            limit: options.limit ?? 200,
            sort: options.sort ?? 'updatedAt:-1'
        }
    });
    return Array.isArray(data) ? data : [];
};
