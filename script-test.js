console.log("!!! TEST SCRIPT LOADED !!!");
window.app = {
    init: () => {
        console.log("App init running...");
        const select = document.getElementById('login-user-select');
        if (select) {
            select.innerHTML = '<option value="1">Admin</option>';
            console.log("Dropdown populated!");
        }
    }
};
