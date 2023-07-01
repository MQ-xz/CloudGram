class Storage {
    constructor() {
        this.key = 'data';
    }

    getData() {
        return JSON.parse(localStorage.getItem(this.key));
    }

    setData(data) {
        localStorage.setItem(this.key, JSON.stringify(data));
    }

    addFile() {
        let name = 'name';
        let _data = this.getData();
        console.log(_data);
        this.setData([..._data, { name: name, type: 'file' }]);
    }
}

export default new Storage;
