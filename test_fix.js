const appLogic = (() => {
    const getVisibleUserIds = async (user) => {
        const allUsers = await AppDataStore.getAll('users');
        return allUsers;
    };

    const canViewProspect = async (prospect) => {
        const visibleIds = await getVisibleUserIds(prospect.user);
        return visibleIds.includes(prospect.id);
    };

    async function legacyFunc(data) {
        await doSomething(data);
    }

    const obj = {
        async method() {
            const val = await this.other();
            return val;
        },
        other() {
            return 42;
        }
    };
    
    const doubleCall = async () => {
        const a = await getVisibleUserIds();
        const b = await legacyFunc();
    };

    return { getVisibleUserIds, canViewProspect, legacyFunc, obj, doubleCall };
})();
