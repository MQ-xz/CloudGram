import { v4 as uuidv4 } from 'uuid';

class Storage {
    constructor() {
        this.key = 'data';
    }

    getData() {
        return JSON.parse(localStorage.getItem(this.key)) || []
    }

    setData(data) {
        localStorage.setItem(this.key, JSON.stringify(data));
    }

    addData(data) {
        let _data = this.getData();
        this.setData([..._data, ...[data]]);
    }

    newFile() {
        let newFile = { id: uuidv4(), name: 'New file' }
        this.addData({ ...newFile, type: 'file' });
    }

    newFolder() {
        let newFolder = { id: uuidv4(), name: 'New folder' }
        this.addData({ ...newFolder, type: 'folder' });
    }

    delete(id) {
        let _data = this.getData();
        let newData = _data.filter(item => item.id !== id);
        this.setData(newData);
    }
}

export default new Storage;
